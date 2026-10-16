import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NpmLockfileParser } from "../../src/modules/ingestion/npm-lockfile.parser.js";
import { AppError } from "../../src/shared/errors/app-error.js";

const fixture = readFileSync(
    new URL("../fixtures/npm/package-lock.v3.json", import.meta.url),
    "utf8",
);
const parser = new NpmLockfileParser();
const mutate = (fn: (lock: any) => void): string => {
    const lock = JSON.parse(fixture);
    fn(lock);
    return JSON.stringify(lock);
};
const code = (fn: () => unknown): string | undefined => {
    try {
        fn();
    } catch (e) {
        return e instanceof AppError ? e.code : "NOT_APP_ERROR";
    }
    return undefined;
};

describe("NpmLockfileParser", () => {
    const result = parser.parse(fixture);

    it("extracts root identity and provenance", () => {
        expect(result.ecosystem).toBe("npm");
        expect(result.root).toEqual({ name: "fixture-app", version: "1.0.0" });
        expect(result.source).toEqual({ file: "package-lock.json", lockfileVersion: 3 });
    });

    it("keeps distinct resolved versions of the same package as separate nodes", () => {
        const ids = result.packages.map((p) => p.id);
        expect(ids).toEqual([
            "npm:@scope/util@1.2.0",
            "npm:dev-tool@1.0.0",
            "npm:lib-a@1.0.0",
            "npm:lib-b@2.0.0",
            "npm:lib-c@1.0.0",
            "npm:lib-c@2.0.0",
            "npm:lib-d@1.1.0",
        ]);
    });

    it("resolves dependencies like Node (nested install wins over hoisted)", () => {
        const edges = result.edges.map((e) => `${e.from} -> ${e.to}`);
        expect(edges).toEqual([
            "npm:lib-a@1.0.0 -> npm:lib-c@1.0.0",
            "npm:lib-b@2.0.0 -> npm:lib-c@2.0.0",
            "npm:lib-c@1.0.0 -> npm:lib-d@1.1.0",
            "npm:lib-c@2.0.0 -> npm:lib-d@1.1.0",
            "npm:lib-d@1.1.0 -> npm:@scope/util@1.2.0",
        ]);
    });

    it("marks direct vs transitive and dev packages", () => {
        const direct = result.directDependencies.map((d) => `${d.id}:${d.kind}`);
        expect(direct).toEqual([
            "npm:dev-tool@1.0.0:dev",
            "npm:lib-a@1.0.0:prod",
            "npm:lib-b@2.0.0:prod",
        ]);
        const get = (id: string) => result.packages.find((p) => p.id === id)!;
        expect(get("npm:lib-a@1.0.0").direct).toBe(true);
        expect(get("npm:lib-c@1.0.0").direct).toBe(false);
        expect(get("npm:dev-tool@1.0.0").dev).toBe(true);
        expect(get("npm:lib-a@1.0.0").dev).toBe(false);
    });

    it("skips optional dependencies that are not installed", () => {
        expect(result.packages.some((p) => p.name === "lib-opt")).toBe(false);
    });

    it("records install-path provenance", () => {
        const c2 = result.packages.find((p) => p.id === "npm:lib-c@2.0.0")!;
        expect(c2.lockfilePaths).toEqual(["node_modules/lib-b/node_modules/lib-c"]);
    });

    it("is deterministic", () => {
        expect(parser.parse(fixture)).toEqual(result);
    });

    it("merges the same version installed at several paths into one node", () => {
        const out = parser.parse(
            mutate((l) => {
                l.packages["node_modules/lib-a/node_modules/lib-d"] = { version: "1.1.0" };
                l.packages["node_modules/lib-a/node_modules/lib-d"].dependencies = { "@scope/util": "^1.0.0" };
            }),
        );
        const d = out.packages.filter((p) => p.id === "npm:lib-d@1.1.0");
        expect(d).toHaveLength(1);
        expect(d[0]!.lockfilePaths).toHaveLength(2);
    });

    it("rejects invalid JSON", () => {
        expect(code(() => parser.parse("{ nope"))).toBe("INVALID_LOCKFILE");
    });

    it("rejects lockfileVersion 1 as unsupported", () => {
        expect(code(() => parser.parse(JSON.stringify({ lockfileVersion: 1, dependencies: {} })))).toBe(
            "UNSUPPORTED_LOCKFILE",
        );
    });

    it("rejects workspaces and linked packages as unsupported", () => {
        expect(code(() => parser.parse(mutate((l) => (l.packages[""].workspaces = ["packages/*"]))))).toBe(
            "UNSUPPORTED_LOCKFILE",
        );
        expect(
            code(() =>
                parser.parse(mutate((l) => (l.packages["node_modules/ws"] = { resolved: "packages/ws", link: true }))),
            ),
        ).toBe("UNSUPPORTED_LOCKFILE");
    });

    it("rejects a required dependency missing from the lockfile", () => {
        expect(code(() => parser.parse(mutate((l) => delete l.packages["node_modules/lib-d"])))).toBe(
            "INVALID_LOCKFILE",
        );
    });

    it("rejects a package entry without a version", () => {
        expect(code(() => parser.parse(mutate((l) => delete l.packages["node_modules/lib-a"].version)))).toBe(
            "INVALID_LOCKFILE",
        );
    });

    it("rejects a lockfile with no packages section", () => {
        expect(code(() => parser.parse(JSON.stringify({ lockfileVersion: 3 })))).toBe("INVALID_LOCKFILE");
    });
});