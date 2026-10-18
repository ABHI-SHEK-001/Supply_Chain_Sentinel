import { createHash } from "node:crypto";
import semver from "semver";
import { z } from "zod";
import { repositoryNodeId } from "../../infrastructure/graph/schema.js";
import { notFound } from "../../shared/errors/app-error.js";
import type { GraphLike } from "../../shared/types/common.js";
import type { OsvClient } from "../vulnerabilities/osv.client.js";
import type { PackageLookup } from "../vulnerabilities/osv.types.js";
import { solveMinimumCover, type Candidate } from "./remediation.optimizer.js";
import type {
    PlanSummary,
    PlanUpgrade,
    PlanValidation,
    RemediationPlan,
    UncoveredTarget,
} from "./remediation.types.js";
import { isMajorBump, isVersionAffected, satisfiesRange, type RangeSpec } from "./versioning.js";

// Constant Cypher only; every value travels as a parameter.
const LOAD_REPOSITORY = "MATCH (r:Repository {id: $id}) RETURN r.id AS id, r.lockfileSha256 AS lockfileSha256";

const LOAD_NODES =
    "MATCH (:Repository {id: $id})-[c:CONTAINS]->(v:PackageVersion) " +
    "RETURN v.id AS id, c.direct AS direct, v.osvCheckedAt AS osvCheckedAt ORDER BY v.id";

const LOAD_EDGES =
    "MATCH (a:PackageVersion)-[d:DEPENDS_ON {repositoryId: $id}]->(b:PackageVersion) " +
    "RETURN a.id AS src, b.id AS dst, d.range AS range ORDER BY a.id, b.id";

const LOAD_FINDINGS =
    "MATCH (:Repository {id: $id})-[:CONTAINS]->(v:PackageVersion)-[a:AFFECTED_BY]->(x:Vulnerability) " +
    "RETURN x.id AS vulnerabilityId, x.severityLabel AS severityLabel, v.id AS packageVersionId, " +
    "v.name AS name, v.version AS version, v.ecosystem AS ecosystem, " +
    "a.fixedVersions AS fixedVersions, a.rangesJson AS rangesJson ORDER BY x.id, v.id";

const UPSERT_PLAN =
    "MERGE (p:RemediationPlan {id: $id}) " +
    "SET p.repositoryId = $repositoryId, p.createdAt = coalesce(p.createdAt, $now), p.updatedAt = $now, " +
    "p.status = $status, p.optimality = $optimality, p.upgradeCount = $upgradeCount, " +
    "p.uncoveredCount = $uncoveredCount, p.lockfileSha256 = $lockfileSha256, p.planJson = $planJson";

const LINK_PLAN_REPOSITORY =
    "MATCH (r:Repository {id: $repositoryNodeId}) MATCH (p:RemediationPlan {id: $id}) MERGE (r)-[:HAS_PLAN]->(p)";

const LINK_PLAN_TARGETS =
    "UNWIND $vulnerabilityIds AS vid " +
    "MATCH (p:RemediationPlan {id: $id}) MATCH (x:Vulnerability {id: vid}) MERGE (p)-[:TARGETS]->(x)";

const LINK_PLAN_UPGRADES =
    "UNWIND $upgrades AS u " +
    "MATCH (p:RemediationPlan {id: $id}) MATCH (v:PackageVersion {id: u.packageVersionId}) " +
    "MERGE (p)-[r:UPGRADES]->(v) SET r.fromVersion = u.fromVersion, r.toVersion = u.toVersion";

const LOAD_PLAN =
    "MATCH (p:RemediationPlan {id: $id}) RETURN p.planJson AS planJson, p.lastValidationJson AS validationJson";

const SAVE_VALIDATION =
    "MATCH (p:RemediationPlan {id: $id}) " +
    "SET p.lastValidationJson = $json, p.lastValidationStatus = $status, p.validatedAt = $now";

const PLAN_SUMMARY_COLUMNS =
    "RETURN p.id AS id, p.repositoryId AS repositoryId, p.createdAt AS createdAt, p.updatedAt AS updatedAt, " +
    "p.status AS status, p.upgradeCount AS upgradeCount, p.uncoveredCount AS uncoveredCount, " +
    "p.lastValidationStatus AS validationStatus ORDER BY p.updatedAt DESC";
const LIST_PLANS = "MATCH (p:RemediationPlan) " + PLAN_SUMMARY_COLUMNS;
const LIST_PLANS_FOR_REPOSITORY = "MATCH (p:RemediationPlan {repositoryId: $repositoryId}) " + PLAN_SUMMARY_COLUMNS;

interface RepoRow { id: string; lockfileSha256: string | null }
interface NodeRow { id: string; direct: boolean | null; osvCheckedAt: string | null }
interface EdgeRow { src: string; dst: string; range: string | null }
interface FindingRow {
    vulnerabilityId: string;
    severityLabel: string | null;
    packageVersionId: string;
    name: string;
    version: string;
    ecosystem: string;
    fixedVersions: string[] | null;
    rangesJson: string | null;
}

const rangesSchema = z.array(
    z.object({ type: z.string(), events: z.array(z.record(z.string(), z.string())) }),
);

function parseRanges(json: string | null): RangeSpec[] | null {
    if (!json) return null;
    try {
        const parsed = rangesSchema.safeParse(JSON.parse(json));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

const OBJECTIVE =
    "Minimize, in strict priority: (1) number of package upgrades, (2) number of semver-major upgrades, " +
    "(3) number of known vulnerabilities remaining in the chosen versions.";

const ASSUMPTIONS = [
    "Only upgrades of the vulnerable package version itself are modeled. Fixing a transitive vulnerability by upgrading a parent package is not modeled yet.",
    "Candidate versions are the fixed versions reported by OSV; each was re-queried against OSV and judged with OSV's own version ranges.",
    "Upgraded versions are assumed to keep their current dependency sets until a real install re-resolves them.",
    "No repository files were changed and nothing was installed.",
];

const stableHash = (value: unknown): string =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

export interface GeneratePlanInput {
    repositoryId: string;
    vulnerabilityIds?: string[] | undefined;
}

interface CandidatePayload {
    packageVersionId: string;
    toVersion: string;
    residual: string[];
}

export class RemediationService {
    constructor(
        private readonly graph: GraphLike,
        private readonly osv: Pick<OsvClient, "queryPackages">,
        private readonly clock: () => Date = () => new Date(),
    ) { }

    private async loadModel(slug: string) {
        const id = repositoryNodeId(slug);
        const repo = (await this.graph.readQuery<RepoRow>(LOAD_REPOSITORY, { id })).data?.[0];
        if (!repo) throw notFound(`Repository "${slug}" not found`);
        const nodes = (await this.graph.readQuery<NodeRow>(LOAD_NODES, { id })).data ?? [];
        const edges = (await this.graph.readQuery<EdgeRow>(LOAD_EDGES, { id })).data ?? [];
        const findings = (await this.graph.readQuery<FindingRow>(LOAD_FINDINGS, { id })).data ?? [];
        return { id, lockfileSha256: repo.lockfileSha256 ?? null, nodes, edges, findings };
    }

    async generatePlan(input: GeneratePlanInput): Promise<RemediationPlan> {
        const slug = input.repositoryId;
        const model = await this.loadModel(slug);
        const filter = input.vulnerabilityIds ? new Set(input.vulnerabilityIds) : null;
        const findings = model.findings.filter((f) => !filter || filter.has(f.vulnerabilityId));
        const nodeById = new Map(model.nodes.map((n) => [n.id, n]));

        const byNode = new Map<string, FindingRow[]>();
        for (const f of findings) byNode.set(f.packageVersionId, [...(byNode.get(f.packageVersionId) ?? []), f]);

        // 1. Candidate versions per node, from OSV-reported fixed versions.
        const uncovered: UncoveredTarget[] = [];
        const candidateVersions = new Map<string, string[]>();
        for (const [pvId, fs] of byNode) {
            const first = fs[0] as FindingRow;
            const target = { packageVersionId: pvId, name: first.name, version: first.version, vulnerabilityIds: fs.map((f) => f.vulnerabilityId) };
            if (fs.some((f) => f.fixedVersions === null || parseRanges(f.rangesJson) === null)) {
                uncovered.push({ ...target, reason: "vulnerability_details_unavailable", detail: "OSV's full record or version ranges for at least one finding are not available; re-run the scan." });
                continue;
            }
            const versions = [...new Set(fs.flatMap((f) => f.fixedVersions ?? []))]
                .filter((v) => semver.valid(v) !== null && semver.gt(v, first.version))
                .sort(semver.compare);
            if (versions.length === 0) {
                uncovered.push({ ...target, reason: "no_fixed_version_reported", detail: "OSV reports no fixed version newer than the installed one." });
                continue;
            }
            candidateVersions.set(pvId, versions);
        }

        // 2. Verify every candidate against OSV (one deduplicated batch).
        const lookupKeys = new Map<string, { name: string; version: string }>();
        for (const [pvId, versions] of candidateVersions) {
            const name = (byNode.get(pvId)?.[0] as FindingRow).name;
            for (const v of versions) lookupKeys.set(`${name}@${v}`, { name, version: v });
        }
        const keys = [...lookupKeys.keys()].sort();
        const lookups = keys.length
            ? await this.osv.queryPackages(keys.map((k) => ({ ecosystem: "npm", ...(lookupKeys.get(k) as { name: string; version: string }) })))
            : [];
        const lookupByKey = new Map<string, PackageLookup>(keys.map((k, i) => [k, lookups[i] as PackageLookup]));

        // 3. Build candidates: valid only if the version is unaffected by every targeted finding on the node.
        const candidates: Array<Candidate<CandidatePayload>> = [];
        for (const [pvId, versions] of candidateVersions) {
            const fs = byNode.get(pvId) as FindingRow[];
            const first = fs[0] as FindingRow;
            let lookupFailed = false;
            let valid = 0;
            for (const v of versions) {
                const lookup = lookupByKey.get(`${first.name}@${v}`);
                if (!lookup || lookup.status === "failed") {
                    lookupFailed = true;
                    continue;
                }
                const clearsAll = fs.every((f) => isVersionAffected(v, parseRanges(f.rangesJson) ?? []) === false);
                if (!clearsAll) continue;
                valid++;
                candidates.push({
                    id: `${pvId}->${v}`,
                    covers: [pvId],
                    cost: [1, isMajorBump(first.version, v) ? 1 : 0, lookup.vulnIds.length],
                    payload: { packageVersionId: pvId, toVersion: v, residual: lookup.vulnIds },
                });
            }
            if (valid === 0) {
                uncovered.push({
                    packageVersionId: pvId,
                    name: first.name,
                    version: first.version,
                    vulnerabilityIds: fs.map((f) => f.vulnerabilityId),
                    reason: lookupFailed ? "candidate_lookup_failed" : "no_verified_candidate",
                    detail: lookupFailed
                        ? "OSV could not be reached for one or more candidate versions; retry later."
                        : "No single reported fixed version is unaffected by all targeted vulnerabilities on this package.",
                });
            }
        }

        // 4. Solve exactly.
        const solution = solveMinimumCover([...candidateVersions.keys()], candidates);

        const upgrades: PlanUpgrade[] = solution.selected.map((c) => {
            const { packageVersionId, toVersion, residual } = c.payload;
            const fs = byNode.get(packageVersionId) as FindingRow[];
            const first = fs[0] as FindingRow;
            const direct = nodeById.get(packageVersionId)?.direct === true;
            const parents = model.edges.filter((e) => e.dst === packageVersionId);
            const checks = parents.map((p) => ({ parentId: p.src, range: p.range ?? "", ok: p.range ? satisfiesRange(toVersion, p.range) : null }));
            const blocking = checks.filter((x) => x.ok === false).map(({ parentId, range }) => ({ parentId, range }));
            const status = blocking.length > 0 ? "incompatible" : checks.some((x) => x.ok === null) ? "unknown" : "compatible";
            return {
                packageVersionId,
                ecosystem: first.ecosystem,
                name: first.name,
                fromVersion: first.version,
                toVersion,
                kind: direct ? "direct" : "transitive",
                majorBump: isMajorBump(first.version, toVersion),
                eliminates: fs.map((f) => ({ vulnerabilityId: f.vulnerabilityId, severityLabel: f.severityLabel })),
                residualVulnerabilityIds: residual,
                parentCompatibility: { status, blockingParents: blocking },
                suggestedAction: suggestAction(direct, first.name, toVersion, status, blocking.map((b) => b.parentId)),
            } satisfies PlanUpgrade;
        });

        const uncheckedCount = model.nodes.filter((n) => !n.osvCheckedAt).length;
        const targetedFindings = findings.map((f) => ({ vulnerabilityId: f.vulnerabilityId, packageVersionId: f.packageVersionId }));
        const vulnerabilityIds = [...new Set(targetedFindings.map((f) => f.vulnerabilityId))].sort();
        const planId = `plan_${stableHash({ slug, sha: model.lockfileSha256, findings: targetedFindings.map((f) => `${f.vulnerabilityId}|${f.packageVersionId}`).sort() })}`;

        const plan: RemediationPlan = {
            id: planId,
            repositoryId: slug,
            generatedAt: this.clock().toISOString(),
            lockfileSha256: model.lockfileSha256,
            status: upgrades.length === 0 && uncovered.length === 0 ? "no_action_needed" : "proposed",
            objective: OBJECTIVE,
            optimality: solution.optimality,
            assumptions: ASSUMPTIONS,
            coverage: { complete: model.nodes.length > 0 && uncheckedCount === 0, packagesUnchecked: uncheckedCount },
            targeted: { findingCount: targetedFindings.length, vulnerabilityCount: vulnerabilityIds.length, vulnerabilityIds, findings: targetedFindings },
            upgrades,
            uncovered: uncovered.sort((a, b) => a.packageVersionId.localeCompare(b.packageVersionId)),
            validation: null,
        };

        await this.persist(plan, model.id);
        return plan;
    }

    private async persist(plan: RemediationPlan, repositoryNodeIdValue: string): Promise<void> {
        const now = this.clock().toISOString();
        await this.graph.query(UPSERT_PLAN, {
            id: plan.id,
            repositoryId: plan.repositoryId,
            now,
            status: plan.status,
            optimality: plan.optimality,
            upgradeCount: plan.upgrades.length,
            uncoveredCount: plan.uncovered.length,
            lockfileSha256: plan.lockfileSha256 ?? "",
            planJson: JSON.stringify(plan),
        });
        await this.graph.query(LINK_PLAN_REPOSITORY, { id: plan.id, repositoryNodeId: repositoryNodeIdValue });
        if (plan.targeted.vulnerabilityIds.length > 0) {
            await this.graph.query(LINK_PLAN_TARGETS, { id: plan.id, vulnerabilityIds: plan.targeted.vulnerabilityIds });
        }
        if (plan.upgrades.length > 0) {
            await this.graph.query(LINK_PLAN_UPGRADES, {
                id: plan.id,
                upgrades: plan.upgrades.map((u) => ({ packageVersionId: u.packageVersionId, fromVersion: u.fromVersion, toVersion: u.toVersion })),
            });
        }
    }

    async listPlans(repositoryId?: string): Promise<PlanSummary[]> {
        const res = repositoryId
            ? await this.graph.readQuery<PlanSummary & { validationStatus: string | null }>(LIST_PLANS_FOR_REPOSITORY, { repositoryId })
            : await this.graph.readQuery<PlanSummary & { validationStatus: string | null }>(LIST_PLANS);
        return (res.data ?? []).map((r) => ({
            id: r.id,
            repositoryId: r.repositoryId,
            createdAt: r.createdAt ?? null,
            updatedAt: r.updatedAt ?? null,
            status: r.status ?? null,
            upgradeCount: Number(r.upgradeCount ?? 0),
            uncoveredCount: Number(r.uncoveredCount ?? 0),
            validationStatus: r.validationStatus ?? null,
        }));
    }

    async getPlan(planId: string): Promise<RemediationPlan> {
        const row = (await this.graph.readQuery<{ planJson: string | null; validationJson: string | null }>(LOAD_PLAN, { id: planId })).data?.[0];
        if (!row?.planJson) throw notFound(`Remediation plan "${planId}" not found`);
        const plan = JSON.parse(row.planJson) as RemediationPlan;
        plan.validation = row.validationJson ? (JSON.parse(row.validationJson) as PlanValidation) : null;
        return plan;
    }

    /** Applies the plan to a temporary model of the current graph; never touches repository files. */
    async validatePlan(planId: string): Promise<PlanValidation> {
        const plan = await this.getPlan(planId);
        const model = await this.loadModel(plan.repositoryId);
        const now = this.clock().toISOString();

        const base: PlanValidation = {
            planId,
            validatedAt: now,
            status: "valid",
            fullyResolvesTargets: false,
            eliminatedFindings: 0,
            notEliminated: [],
            uncoveredTargetCount: plan.uncovered.length,
            parentRangeViolations: [],
            targetVersionVulnerabilities: [],
            lookupFailures: [],
            notes: [],
        };

        let result: PlanValidation;
        if (model.lockfileSha256 !== plan.lockfileSha256) {
            result = { ...base, status: "stale", notes: ["The repository's lockfile changed after this plan was generated. Generate a new plan."] };
        } else {
            const findingsByNode = new Map<string, FindingRow[]>();
            for (const f of model.findings) findingsByNode.set(f.packageVersionId, [...(findingsByNode.get(f.packageVersionId) ?? []), f]);

            const keys = plan.upgrades.map((u) => ({ ecosystem: "npm", name: u.name, version: u.toVersion }));
            const lookups = keys.length ? await this.osv.queryPackages(keys) : [];

            const notEliminated: PlanValidation["notEliminated"] = [];
            const violations: PlanValidation["parentRangeViolations"] = [];
            const targetVulns: PlanValidation["targetVersionVulnerabilities"] = [];
            const failures: PlanValidation["lookupFailures"] = [];
            let eliminated = 0;

            plan.upgrades.forEach((u, i) => {
                const targeted = new Set(plan.targeted.findings.filter((f) => f.packageVersionId === u.packageVersionId).map((f) => f.vulnerabilityId));
                const current = (findingsByNode.get(u.packageVersionId) ?? []).filter((f) => targeted.has(f.vulnerabilityId));
                for (const vid of targeted) {
                    const f = current.find((c) => c.vulnerabilityId === vid);
                    if (!f) {
                        notEliminated.push({ packageVersionId: u.packageVersionId, vulnerabilityId: vid, reason: "finding no longer present in the graph" });
                        continue;
                    }
                    const affected = isVersionAffected(u.toVersion, parseRanges(f.rangesJson) ?? []);
                    if (affected === false) eliminated++;
                    else notEliminated.push({ packageVersionId: u.packageVersionId, vulnerabilityId: vid, reason: affected === true ? "target version is still affected" : "affected status could not be determined" });
                }
                for (const e of model.edges.filter((x) => x.dst === u.packageVersionId)) {
                    if (e.range && satisfiesRange(u.toVersion, e.range) === false) {
                        violations.push({ packageVersionId: u.packageVersionId, parentId: e.src, range: e.range, toVersion: u.toVersion });
                    }
                }
                const lookup = lookups[i];
                if (!lookup || lookup.status === "failed") {
                    failures.push({ packageVersionId: u.packageVersionId, toVersion: u.toVersion, error: lookup?.status === "failed" ? lookup.error : "no lookup result" });
                } else if (lookup.vulnIds.length > 0) {
                    targetVulns.push({ packageVersionId: u.packageVersionId, toVersion: u.toVersion, vulnerabilityIds: lookup.vulnIds });
                }
            });

            const status = notEliminated.length > 0 ? "invalid" : failures.length > 0 ? "unverified" : "valid";
            result = {
                ...base,
                status,
                fullyResolvesTargets: status === "valid" && plan.uncovered.length === 0,
                eliminatedFindings: eliminated,
                notEliminated,
                parentRangeViolations: violations,
                targetVersionVulnerabilities: targetVulns,
                lookupFailures: failures,
                notes: [
                    "Checked against the current graph with each upgrade applied in a temporary model; upgraded versions are assumed to keep their current dependency sets.",
                    ...(plan.uncovered.length > 0 ? [`${plan.uncovered.length} targeted package(s) have no verified upgrade and remain exposed.`] : []),
                ],
            };
        }

        await this.graph.query(SAVE_VALIDATION, { id: planId, json: JSON.stringify(result), status: result.status, now });
        return result;
    }
}

function suggestAction(
    direct: boolean,
    name: string,
    to: string,
    compat: "compatible" | "incompatible" | "unknown",
    blockingParents: string[],
): string {
    if (direct && compat !== "incompatible") return `Upgrade the direct dependency ${name} to ${to} (for example: npm install ${name}@${to}).`;
    if (compat === "compatible") return `Re-resolve ${name} to ${to}: every parent's declared range allows it (for example: npm update ${name}, then review the lockfile).`;
    if (compat === "incompatible") return `Parent range(s) from ${blockingParents.join(", ")} exclude ${to}. Add an npm "overrides" entry for ${name}@${to}, or upgrade those parents.`;
    return `Parent ranges for ${name} could not be evaluated; confirm ${to} resolves after re-locking.`;
}