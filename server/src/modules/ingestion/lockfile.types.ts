import { AppError } from "../../shared/errors/app-error.js";

/** OSV ecosystem names. PyPI is declared so parsers can be added without changing consumers. */
export type Ecosystem = "npm" | "PyPI";

export type DependencyKind = "prod" | "dev" | "optional" | "peer";

export interface ParsedPackage {
    /** Stable id: `<ecosystem>:<name>@<version>`. One node per resolved version. */
    id: string;
    ecosystem: Ecosystem;
    name: string;
    version: string;
    /** Required directly by the root project (any kind). */
    direct: boolean;
    /** True only when every installed instance is dev-only. */
    dev: boolean;
    /** True only when every installed instance is optional. */
    optional: boolean;
    resolved?: string | undefined;
    integrity?: string | undefined;
    /** Where this version is installed in the lockfile (provenance). */
    lockfilePaths: string[];
}

/**
 * Direction: `from` REQUIRES `to` (from -[:DEPENDS_ON]-> to).
 * Both ends are resolved package-version ids; `range` is the declared semver range.
 */
export interface ParsedDependencyEdge {
    from: string;
    to: string;
    kind: DependencyKind;
    range: string;
}

export interface ParsedDirectDependency {
    id: string;
    kind: DependencyKind;
    range: string;
}

export interface ParsedLockfile {
    ecosystem: Ecosystem;
    source: { file: string; lockfileVersion: number };
    root: { name?: string | undefined; version?: string | undefined };
    packages: ParsedPackage[];
    edges: ParsedDependencyEdge[];
    directDependencies: ParsedDirectDependency[];
}

export interface LockfileParser {
    readonly ecosystem: Ecosystem;
    readonly filenames: readonly string[];
    parse(content: string): ParsedLockfile;
}

export const invalidLockfile = (message: string) =>
    new AppError(400, "INVALID_LOCKFILE", message);

export const unsupportedLockfile = (message: string) =>
    new AppError(422, "UNSUPPORTED_LOCKFILE", message);