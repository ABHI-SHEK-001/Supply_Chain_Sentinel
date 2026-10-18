export interface AnalysisOptions {
    /** Hard bound on dependency edges per enumerated path. */
    maxDepth: number;
    /** Max paths returned per finding (reachability/entry points are always exact). */
    maxPathsPerFinding: number;
}

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = { maxDepth: 30, maxPathsPerFinding: 10 };

/** Why a finding's path list is incomplete. */
export type Truncation = "path_limit" | "depth_limit" | "search_budget";

export interface PathView {
    /** Number of DEPENDS_ON edges. 0 means the direct dependency itself is the affected version. */
    length: number;
    /** True when the entry dependency is dev-only. */
    devOnly: boolean;
    /**
     * Package-version ids. Read as "requires": nodes[0] is a direct dependency of the
     * repository, each node requires the next, the last is the affected version.
     */
    nodes: string[];
}

export interface FindingExposure {
    vulnerability: {
        id: string;
        summary: string | null;
        severityLabel: string | null;
        sourceUrl: string | null;
        /** `unavailable` means OSV reported the id but its full record was not retrieved. */
        detailsStatus: string | null;
    };
    affected: {
        packageVersionId: string;
        ecosystem: string;
        name: string;
        version: string;
        /** From OSV; null when the record was unavailable. Not yet validated against ranges. */
        fixedVersions: string[] | null;
    };
    /** The affected version is itself a direct dependency of the repository. */
    direct: boolean;
    reachableFromRoot: boolean;
    /** Exact: every direct dependency that leads to the affected version. */
    entryPoints: string[];
    shortestPathLength: number | null;
    paths: PathView[];
    pathsTruncated: boolean;
    truncation: Truncation | null;
}

export interface Coverage {
    packagesTotal: number;
    packagesChecked: number;
    packagesUnchecked: number;
    /** Latest OSV check time among this repository's packages, or null if never checked. */
    lastCheckedAt: string | null;
    /** False means "no findings" cannot be read as "no vulnerabilities". */
    complete: boolean;
}

export interface RepositoryExposure {
    repositoryId: string;
    analyzedAt: string;
    options: AnalysisOptions;
    coverage: Coverage;
    summary: {
        findingCount: number;
        vulnerabilityCount: number;
        directlyAffectedCount: number;
        bySeverity: Record<string, number>;
    };
    findings: FindingExposure[];
}

export interface GraphView {
    repositoryId: string;
    totalNodes: number;
    totalEdges: number;
    truncated: boolean;
    nodes: Array<{
        id: string;
        ecosystem: string;
        name: string;
        version: string;
        direct: boolean;
        dev: boolean;
        optional: boolean;
        vulnerabilityIds: string[];
    }>;
    /** `source` requires `target`. */
    edges: Array<{ source: string; target: string; kind: string }>;
}

export interface VulnerabilitySummary {
    id: string;
    summary: string | null;
    severityLabel: string | null;
    sourceUrl: string | null;
    detailsStatus: string | null;
    aliases: string[];
    repositoryCount: number;
    packageVersionCount: number;
    repositories: string[];
}

export interface VulnerabilityDetail {
    vulnerability: {
        id: string;
        summary: string | null;
        details: string | null;
        aliases: string[];
        severityLabel: string | null;
        /** Raw OSV severity entries (e.g. CVSS vectors), as reported. */
        severity: unknown[] | null;
        published: string | null;
        modified: string | null;
        withdrawn: string | null;
        references: string[];
        sourceUrl: string | null;
        detailsStatus: string | null;
        lastCheckedAt: string | null;
    };
    repositories: Array<{ repositoryId: string; findings: FindingExposure[] }>;
}