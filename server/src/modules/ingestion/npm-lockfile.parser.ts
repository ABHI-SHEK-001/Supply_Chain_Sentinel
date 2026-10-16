import { z } from "zod";
import { packageVersionId } from "../../infrastructure/graph/schema.js";
import {
    invalidLockfile,
    unsupportedLockfile,
    type DependencyKind,
    type LockfileParser,
    type ParsedDependencyEdge,
    type ParsedDirectDependency,
    type ParsedLockfile,
    type ParsedPackage,
} from "./lockfile.types.js";

const depMap = z.record(z.string(), z.string());

const entrySchema = z.object({
    name: z.string().optional(),
    version: z.string().optional(),
    resolved: z.string().optional(),
    integrity: z.string().optional(),
    link: z.boolean().optional(),
    dev: z.boolean().optional(),
    optional: z.boolean().optional(),
    workspaces: z.unknown().optional(),
    dependencies: depMap.optional(),
    devDependencies: depMap.optional(),
    optionalDependencies: depMap.optional(),
    peerDependencies: depMap.optional(),
});

const lockfileSchema = z.object({
    name: z.string().optional(),
    version: z.string().optional(),
    lockfileVersion: z.number().int(),
    packages: z.record(z.string(), entrySchema).optional(),
});

const SUPPORTED_LOCKFILE_VERSIONS = new Set([2, 3]);
const NM = "node_modules/";

function nameFromPath(path: string): string {
    return path.slice(path.lastIndexOf(NM) + NM.length);
}

/** Node-style resolution: look in <path>/node_modules, then walk up to the root. */
function resolveDependency(
    fromPath: string,
    depName: string,
    idByPath: ReadonlyMap<string, string>,
): string | undefined {
    let base = fromPath;
    for (; ;) {
        const candidate = base === "" ? `${NM}${depName}` : `${base}/${NM}${depName}`;
        const id = idByPath.get(candidate);
        if (id !== undefined) return id;
        if (base === "") return undefined;
        const idx = base.lastIndexOf(NM);
        base = idx <= 0 ? "" : base.slice(0, idx - 1);
    }
}

interface MutablePackage extends ParsedPackage { }

export class NpmLockfileParser implements LockfileParser {
    readonly ecosystem = "npm" as const;
    readonly filenames = ["package-lock.json"] as const;

    parse(content: string): ParsedLockfile {
        let raw: unknown;
        try {
            raw = JSON.parse(content);
        } catch {
            throw invalidLockfile("package-lock.json is not valid JSON");
        }

        const parsed = lockfileSchema.safeParse(raw);
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            throw invalidLockfile(`package-lock.json has an invalid structure: ${issues}`);
        }
        const lock = parsed.data;

        if (!SUPPORTED_LOCKFILE_VERSIONS.has(lock.lockfileVersion)) {
            throw unsupportedLockfile(
                `lockfileVersion ${lock.lockfileVersion} is not supported (supported: 2, 3)`,
            );
        }
        const entries = lock.packages;
        if (!entries) throw invalidLockfile("package-lock.json has no \"packages\" section");
        const rootEntry = entries[""];
        if (!rootEntry) throw invalidLockfile("package-lock.json has no root package entry");
        if (rootEntry.workspaces !== undefined) {
            throw unsupportedLockfile("npm workspaces are not supported yet");
        }

        // Pass 1: one node per resolved name@version, remembering every install path.
        const byId = new Map<string, MutablePackage>();
        const idByPath = new Map<string, string>();
        for (const [path, entry] of Object.entries(entries)) {
            if (path === "") continue;
            if (entry.link === true || !path.includes(NM)) {
                throw unsupportedLockfile(`linked/workspace package "${path}" is not supported yet`);
            }
            if (!entry.version) {
                throw invalidLockfile(`package entry "${path}" has no version`);
            }
            const name = entry.name ?? nameFromPath(path);
            const id = packageVersionId("npm", name, entry.version);
            idByPath.set(path, id);

            const existing = byId.get(id);
            if (existing) {
                existing.dev = existing.dev && entry.dev === true;
                existing.optional = existing.optional && entry.optional === true;
                existing.lockfilePaths.push(path);
                existing.resolved ??= entry.resolved;
                existing.integrity ??= entry.integrity;
            } else {
                byId.set(id, {
                    id,
                    ecosystem: "npm",
                    name,
                    version: entry.version,
                    direct: false,
                    dev: entry.dev === true,
                    optional: entry.optional === true,
                    resolved: entry.resolved,
                    integrity: entry.integrity,
                    lockfilePaths: [path],
                });
            }
        }

        // Pass 2: resolve declared dependencies to the installed instance Node would pick.
        const edges = new Map<string, ParsedDependencyEdge>();
        const direct = new Map<string, ParsedDirectDependency>();

        const addDeps = (
            fromPath: string,
            fromId: string | undefined,
            deps: Record<string, string> | undefined,
            kind: DependencyKind,
            required: boolean,
        ): void => {
            for (const [depName, range] of Object.entries(deps ?? {})) {
                const toId = resolveDependency(fromPath, depName, idByPath);
                if (toId === undefined) {
                    if (required) {
                        throw invalidLockfile(
                            `"${fromPath || "(root)"}" requires "${depName}" but it is not present in the lockfile`,
                        );
                    }
                    continue; // optional/peer dependency that was not installed
                }
                if (fromId === undefined) {
                    if (!direct.has(toId)) direct.set(toId, { id: toId, kind, range });
                    const pkg = byId.get(toId);
                    if (pkg) pkg.direct = true;
                } else if (fromId !== toId) {
                    const key = `${fromId}|${toId}`;
                    if (!edges.has(key)) edges.set(key, { from: fromId, to: toId, kind, range });
                }
            }
        };

        addDeps("", undefined, rootEntry.dependencies, "prod", true);
        addDeps("", undefined, rootEntry.devDependencies, "dev", true);
        addDeps("", undefined, rootEntry.optionalDependencies, "optional", false);
        addDeps("", undefined, rootEntry.peerDependencies, "peer", false);

        for (const [path, entry] of Object.entries(entries)) {
            if (path === "") continue;
            const fromId = idByPath.get(path);
            if (fromId === undefined) continue;
            addDeps(path, fromId, entry.dependencies, "prod", true);
            addDeps(path, fromId, entry.optionalDependencies, "optional", false);
            addDeps(path, fromId, entry.peerDependencies, "peer", false);
        }

        const byKey = <T extends { id?: string; from?: string; to?: string }>(a: T, b: T) =>
            `${a.id ?? a.from}|${a.to ?? ""}`.localeCompare(`${b.id ?? b.from}|${b.to ?? ""}`);

        return {
            ecosystem: "npm",
            source: { file: "package-lock.json", lockfileVersion: lock.lockfileVersion },
            root: { name: lock.name ?? rootEntry.name, version: lock.version ?? rootEntry.version },
            packages: [...byId.values()]
                .map((p) => ({ ...p, lockfilePaths: [...p.lockfilePaths].sort() }))
                .sort(byKey),
            edges: [...edges.values()].sort(byKey),
            directDependencies: [...direct.values()].sort(byKey),
        };
    }
}