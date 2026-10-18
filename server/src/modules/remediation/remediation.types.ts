export interface PlanUpgrade {
    packageVersionId: string;
    ecosystem: string;
    name: string;
    fromVersion: string;
    toVersion: string;
    /** direct: a direct dependency of the repository; transitive: reached only through other packages. */
    kind: "direct" | "transitive";
    majorBump: boolean;
    eliminates: Array<{ vulnerabilityId: string; severityLabel: string | null }>;
    /** Known OSV vulnerabilities of the target version (from a fresh lookup). Empty means none reported. */
    residualVulnerabilityIds: string[];
    parentCompatibility: {
        status: "compatible" | "incompatible" | "unknown";
        blockingParents: Array<{ parentId: string; range: string }>;
    };
    suggestedAction: string;
}

export type UncoveredReason =
    | "vulnerability_details_unavailable"
    | "no_fixed_version_reported"
    | "no_verified_candidate"
    | "candidate_lookup_failed";

export interface UncoveredTarget {
    packageVersionId: string;
    name: string;
    version: string;
    vulnerabilityIds: string[];
    reason: UncoveredReason;
    detail: string;
}

export interface PlanValidation {
    planId: string;
    validatedAt: string;
    /**
     * valid: every claimed elimination is confirmed and OSV lookups succeeded.
     * invalid: at least one claimed elimination is not confirmed.
     * unverified: an OSV lookup failed, so the result cannot be confirmed.
     * stale: the repository's lockfile changed since the plan was generated.
     */
    status: "valid" | "invalid" | "unverified" | "stale";
    /** True when status is valid and nothing targeted remains uncovered. */
    fullyResolvesTargets: boolean;
    eliminatedFindings: number;
    notEliminated: Array<{ packageVersionId: string; vulnerabilityId: string; reason: string }>;
    uncoveredTargetCount: number;
    parentRangeViolations: Array<{ packageVersionId: string; parentId: string; range: string; toVersion: string }>;
    /** Known OSV vulnerabilities of upgrade targets as of this validation. */
    targetVersionVulnerabilities: Array<{ packageVersionId: string; toVersion: string; vulnerabilityIds: string[] }>;
    lookupFailures: Array<{ packageVersionId: string; toVersion: string; error: string }>;
    notes: string[];
}

export interface RemediationPlan {
    id: string;
    repositoryId: string;
    generatedAt: string;
    lockfileSha256: string | null;
    status: "proposed" | "no_action_needed";
    objective: string;
    optimality: "exact" | "budget_exhausted";
    assumptions: string[];
    coverage: { complete: boolean; packagesUnchecked: number };
    targeted: {
        findingCount: number;
        vulnerabilityCount: number;
        vulnerabilityIds: string[];
        findings: Array<{ vulnerabilityId: string; packageVersionId: string }>;
    };
    upgrades: PlanUpgrade[];
    uncovered: UncoveredTarget[];
    validation: PlanValidation | null;
}

export interface PlanSummary {
    id: string;
    repositoryId: string;
    createdAt: string | null;
    updatedAt: string | null;
    status: string | null;
    upgradeCount: number;
    uncoveredCount: number;
    validationStatus: string | null;
}