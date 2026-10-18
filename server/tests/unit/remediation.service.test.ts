import { describe, expect, it, vi } from "vitest";
import { RemediationService } from "../../src/modules/remediation/remediation.service.js";
import type { PackageLookup } from "../../src/modules/vulnerabilities/osv.types.js";

const SHA = "a".repeat(64);
const rangesJson = (fixed: string) => JSON.stringify([{ type: "SEMVER", events: [{ introduced: "0" }, { fixed }] }]);

interface F {
    vuln: string;
    sev?: string | null;
    pv: string;
    fixed: string[] | null;
    ranges?: string | null;
}
const finding = (f: F) => {
    const [name, version] = f.pv.replace("npm:", "").split("@") as [string, string];
    return {
        vulnerabilityId: f.vuln,
        severityLabel: f.sev ?? "HIGH",
        packageVersionId: f.pv,
        name,
        version,
        ecosystem: "npm",
        fixedVersions: f.fixed,
        rangesJson: f.ranges === undefined ? (f.fixed && f.fixed[0] ? rangesJson(f.fixed[0]) : null) : f.ranges,
    };
};

const LODASH = [
    finding({ vuln: "GHSA-A", pv: "npm:lodash@4.17.15", fixed: ["4.17.21"] }),
    finding({ vuln: "GHSA-B", pv: "npm:lodash@4.17.15", fixed: ["4.17.19"] }),
    finding({ vuln: "GHSA-C", pv: "npm:lodash@4.17.15", fixed: ["4.18.0"], sev: "MODERATE" }),
];

function setup(opts: {
    findings: ReturnType<typeof finding>[];
    nodes?: Array<{ id: string; direct: boolean; osvCheckedAt: string | null }>;
    edges?: Array<{ src: string; dst: string; range: string | null }>;
    lookups?: Record<string, PackageLookup>;
    sha?: string;
    repoExists?: boolean;
}) {
    const state = { sha: opts.sha ?? SHA, planJson: null as string | null, validationJson: null as string | null };
    const nodes =
        opts.nodes ??
        [...new Set(opts.findings.map((f) => f.packageVersionId))].map((id) => ({
            id,
            direct: id === "npm:lodash@4.17.15",
            osvCheckedAt: "2026-10-18T00:00:00.000Z",
        }));
    const graph = {
        query: vi.fn().mockImplementation(async (cypher: string, params?: Record<string, unknown>) => {
            if (cypher.includes("MERGE (p:RemediationPlan")) state.planJson = String(params?.["planJson"]);
            if (cypher.includes("SET p.lastValidationJson")) state.validationJson = String(params?.["json"]);
            return { data: [] };
        }),
        readQuery: vi.fn().mockImplementation(async (cypher: string) => {
            if (cypher.includes("r.lockfileSha256 AS lockfileSha256"))
                return { data: opts.repoExists === false ? [] : [{ id: "repo:demo", lockfileSha256: state.sha }] };
            if (cypher.includes("AS osvCheckedAt")) return { data: nodes };
            if (cypher.includes("AS src")) return { data: opts.edges ?? [] };
            if (cypher.includes("AS vulnerabilityId")) return { data: opts.findings };
            if (cypher.includes("p.planJson AS planJson"))
                return { data: state.planJson ? [{ planJson: state.planJson, validationJson: state.validationJson }] : [] };
            return { data: [] };
        }),
    };
    const osv = {
        queryPackages: vi.fn().mockImplementation(async (qs: Array<{ name: string; version: string }>) =>
            qs.map((q): PackageLookup => opts.lookups?.[`${q.name}@${q.version}`] ?? { status: "ok", vulnIds: [] }),
        ),
    };
    const service = new RemediationService(graph, osv, () => new Date("2026-10-18T12:00:00.000Z"));
    return { graph, osv, service, state };
}

const hasUndefined = (v: unknown): boolean =>
    v === undefined || (Array.isArray(v) ? v.some(hasUndefined) : !!v && typeof v === "object" && Object.values(v).some(hasUndefined));

describe("RemediationService.generatePlan", () => {
    it("collapses several advisories on one package into the single cheapest version that clears all of them", async () => {
        const { service, osv } = setup({ findings: LODASH });
        const plan = await service.generatePlan({ repositoryId: "demo" });

        expect(plan.upgrades).toHaveLength(1);
        expect(plan.upgrades[0]).toMatchObject({
            packageVersionId: "npm:lodash@4.17.15",
            fromVersion: "4.17.15",
            toVersion: "4.18.0", // 4.17.19 and 4.17.21 are still affected by GHSA-C
            kind: "direct",
            majorBump: false,
            residualVulnerabilityIds: [],
        });
        expect(plan.upgrades[0]!.eliminates.map((e) => e.vulnerabilityId).sort()).toEqual(["GHSA-A", "GHSA-B", "GHSA-C"]);
        expect(plan).toMatchObject({ status: "proposed", optimality: "exact", uncovered: [] });
        expect(plan.targeted).toMatchObject({ findingCount: 3, vulnerabilityCount: 3 });
        expect(plan.upgrades[0]!.suggestedAction).toContain("npm install lodash@4.18.0");

        // every candidate version was verified in one deduplicated OSV batch
        expect(osv.queryPackages).toHaveBeenCalledTimes(1);
        expect(osv.queryPackages.mock.calls[0]![0]).toEqual([
            { ecosystem: "npm", name: "lodash", version: "4.17.19" },
            { ecosystem: "npm", name: "lodash", version: "4.17.21" },
            { ecosystem: "npm", name: "lodash", version: "4.18.0" },
        ]);
    });

    it("targets only the requested vulnerabilities", async () => {
        const { service } = setup({ findings: LODASH });
        const plan = await service.generatePlan({ repositoryId: "demo", vulnerabilityIds: ["GHSA-A"] });
        expect(plan.targeted).toMatchObject({ findingCount: 1, vulnerabilityIds: ["GHSA-A"] });
        expect(plan.upgrades[0]).toMatchObject({ toVersion: "4.17.21" });
    });

    it("classifies transitive upgrades by parent-range compatibility and flags major bumps", async () => {
        const { service } = setup({
            findings: [
                finding({ vuln: "V-d", pv: "npm:lib-d@1.1.0", fixed: ["1.2.0"] }),
                finding({ vuln: "V-e", pv: "npm:lib-e@1.0.0", fixed: ["2.0.0"] }),
            ],
            edges: [
                { src: "npm:lib-c@1.0.0", dst: "npm:lib-d@1.1.0", range: "^1.0.0" },
                { src: "npm:lib-c@1.0.0", dst: "npm:lib-e@1.0.0", range: "^1.0.0" },
            ],
        });
        const plan = await service.generatePlan({ repositoryId: "demo" });
        const d = plan.upgrades.find((u) => u.name === "lib-d")!;
        const e = plan.upgrades.find((u) => u.name === "lib-e")!;
        expect(d).toMatchObject({ kind: "transitive", parentCompatibility: { status: "compatible", blockingParents: [] } });
        expect(d.suggestedAction).toContain("Re-resolve lib-d to 1.2.0");
        expect(e).toMatchObject({ majorBump: true, parentCompatibility: { status: "incompatible" } });
        expect(e.parentCompatibility.blockingParents).toEqual([{ parentId: "npm:lib-c@1.0.0", range: "^1.0.0" }]);
        expect(e.suggestedAction).toContain("overrides");
    });

    it("prefers a candidate with no known vulnerabilities of its own", async () => {
        const { service } = setup({
            findings: [finding({ vuln: "V-f", pv: "npm:lib-f@1.0.0", fixed: ["1.1.0", "1.2.0"], ranges: rangesJson("1.1.0") })],
            lookups: { "lib-f@1.1.0": { status: "ok", vulnIds: ["GHSA-new"] } },
        });
        const plan = await service.generatePlan({ repositoryId: "demo" });
        expect(plan.upgrades[0]).toMatchObject({ toVersion: "1.2.0", residualVulnerabilityIds: [] });
    });

    it("keeps a residual-vulnerability candidate visible rather than hiding it", async () => {
        const { service } = setup({
            findings: [finding({ vuln: "V-f", pv: "npm:lib-f@1.0.0", fixed: ["1.1.0"] })],
            lookups: { "lib-f@1.1.0": { status: "ok", vulnIds: ["GHSA-new"] } },
        });
        const plan = await service.generatePlan({ repositoryId: "demo" });
        expect(plan.upgrades[0]).toMatchObject({ toVersion: "1.1.0", residualVulnerabilityIds: ["GHSA-new"] });
    });

    it("reports targets it cannot fix, with a reason, instead of guessing", async () => {
        const { service } = setup({
            findings: [
                finding({ vuln: "V-g", pv: "npm:lib-g@1.0.0", fixed: null, ranges: null }),
                finding({ vuln: "V-h", pv: "npm:lib-h@1.0.0", fixed: ["1.0.1"] }),
                finding({ vuln: "V-i", pv: "npm:lib-i@1.0.0", fixed: [], ranges: rangesJson("9.9.9") }),
                finding({ vuln: "V-j", pv: "npm:lib-j@1.0.0", fixed: ["1.1.0"], ranges: rangesJson("1.5.0") }),
            ],
            lookups: { "lib-h@1.0.1": { status: "failed", error: "HTTP 503" } },
        });
        const plan = await service.generatePlan({ repositoryId: "demo" });
        expect(plan.upgrades).toEqual([]);
        expect(Object.fromEntries(plan.uncovered.map((u) => [u.name, u.reason]))).toEqual({
            "lib-g": "vulnerability_details_unavailable",
            "lib-h": "candidate_lookup_failed",
            "lib-i": "no_fixed_version_reported",
            "lib-j": "no_verified_candidate",
        });
        expect(plan.status).toBe("proposed");
    });

    it("returns no_action_needed without calling OSV when there is nothing to fix", async () => {
        const { service, osv } = setup({ findings: [], nodes: [{ id: "npm:a@1.0.0", direct: true, osvCheckedAt: "2026-10-18T00:00:00.000Z" }] });
        const plan = await service.generatePlan({ repositoryId: "demo" });
        expect(plan).toMatchObject({ status: "no_action_needed", upgrades: [], uncovered: [] });
        expect(osv.queryPackages).not.toHaveBeenCalled();
    });

    it("flags incomplete OSV coverage", async () => {
        const { service } = setup({
            findings: LODASH,
            nodes: [
                { id: "npm:lodash@4.17.15", direct: true, osvCheckedAt: "2026-10-18T00:00:00.000Z" },
                { id: "npm:other@1.0.0", direct: false, osvCheckedAt: null },
            ],
        });
        expect((await service.generatePlan({ repositoryId: "demo" })).coverage).toEqual({ complete: false, packagesUnchecked: 1 });
    });

    it("uses stable ids: same inputs give the same plan id, a new lockfile gives a new one", async () => {
        const a = await setup({ findings: LODASH }).service.generatePlan({ repositoryId: "demo" });
        const b = await setup({ findings: LODASH }).service.generatePlan({ repositoryId: "demo" });
        const c = await setup({ findings: LODASH, sha: "b".repeat(64) }).service.generatePlan({ repositoryId: "demo" });
        expect(a.id).toMatch(/^plan_[a-f0-9]{16}$/);
        expect(b.id).toBe(a.id);
        expect(c.id).not.toBe(a.id);
    });

    it("persists the plan with parameterised queries only", async () => {
        const { service, graph, state } = setup({ findings: LODASH });
        const plan = await service.generatePlan({ repositoryId: "demo" });
        expect(JSON.parse(state.planJson as string).id).toBe(plan.id);
        const writes = graph.query.mock.calls as Array<[string, Record<string, unknown>]>;
        expect(writes.some(([c]) => c.includes("MERGE (r)-[:HAS_PLAN]->(p)"))).toBe(true);
        expect(writes.some(([c]) => c.includes("MERGE (p)-[:TARGETS]->(x)"))).toBe(true);
        expect(writes.some(([c]) => c.includes("MERGE (p)-[r:UPGRADES]->(v)"))).toBe(true);
        for (const [cypher, params] of writes) {
            expect(cypher).not.toContain("lodash");
            expect(cypher).not.toContain("GHSA");
            expect(hasUndefined(params)).toBe(false);
        }
    });

    it("returns 404 for an unknown repository", async () => {
        await expect(setup({ findings: [], repoExists: false }).service.generatePlan({ repositoryId: "ghost" })).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("RemediationService.validatePlan", () => {
    it("confirms a plan against the current graph and saves the result", async () => {
        const { service, state } = setup({ findings: LODASH });
        const plan = await service.generatePlan({ repositoryId: "demo" });
        const v = await service.validatePlan(plan.id);
        expect(v).toMatchObject({ status: "valid", eliminatedFindings: 3, fullyResolvesTargets: true, notEliminated: [], lookupFailures: [] });
        expect(JSON.parse(state.validationJson as string).status).toBe("valid");
        expect((await service.getPlan(plan.id)).validation?.status).toBe("valid");
    });

    it("does not claim full resolution when targets remain uncovered", async () => {
        const { service } = setup({
            findings: [...LODASH, finding({ vuln: "V-g", pv: "npm:lib-g@1.0.0", fixed: null, ranges: null })],
        });
        const plan = await service.generatePlan({ repositoryId: "demo" });
        const v = await service.validatePlan(plan.id);
        expect(v.status).toBe("valid");
        expect(v.fullyResolvesTargets).toBe(false);
        expect(v.uncoveredTargetCount).toBe(1);
    });

    it("reports stale when the lockfile changed after the plan was made", async () => {
        const { service, state } = setup({ findings: LODASH });
        const plan = await service.generatePlan({ repositoryId: "demo" });
        state.sha = "c".repeat(64);
        expect((await service.validatePlan(plan.id)).status).toBe("stale");
    });

    it("reports invalid when a claimed elimination does not hold", async () => {
        const { service, state } = setup({ findings: LODASH });
        const plan = await service.generatePlan({ repositoryId: "demo" });
        const tampered = JSON.parse(state.planJson as string);
        tampered.upgrades[0].toVersion = "4.17.20"; // fixes GHSA-B (4.17.19) but not GHSA-A (4.17.21) or GHSA-C (4.18.0)
        state.planJson = JSON.stringify(tampered);
        const v = await service.validatePlan(plan.id);
        expect(v.status).toBe("invalid");
        expect(v.notEliminated.map((n) => n.vulnerabilityId).sort()).toEqual(["GHSA-A", "GHSA-C"]);
        expect(v.eliminatedFindings).toBe(1);
        expect(v.fullyResolvesTargets).toBe(false);
    });

    it("reports unverified, never valid, when OSV cannot be reached", async () => {
        const { service, osv } = setup({ findings: LODASH });
        const plan = await service.generatePlan({ repositoryId: "demo" });
        osv.queryPackages.mockResolvedValueOnce([{ status: "failed", error: "HTTP 503" }]);
        const v = await service.validatePlan(plan.id);
        expect(v.status).toBe("unverified");
        expect(v.lookupFailures).toEqual([{ packageVersionId: "npm:lodash@4.17.15", toVersion: "4.18.0", error: "HTTP 503" }]);
    });

    it("surfaces vulnerabilities newly reported for the target version and parent range violations", async () => {
        const { service, osv } = setup({
            findings: [finding({ vuln: "V-e", pv: "npm:lib-e@1.0.0", fixed: ["2.0.0"] })],
            edges: [{ src: "npm:lib-c@1.0.0", dst: "npm:lib-e@1.0.0", range: "^1.0.0" }],
        });
        const plan = await service.generatePlan({ repositoryId: "demo" });
        osv.queryPackages.mockResolvedValueOnce([{ status: "ok", vulnIds: ["GHSA-late"] }]);
        const v = await service.validatePlan(plan.id);
        expect(v.targetVersionVulnerabilities).toEqual([{ packageVersionId: "npm:lib-e@1.0.0", toVersion: "2.0.0", vulnerabilityIds: ["GHSA-late"] }]);
        expect(v.parentRangeViolations).toEqual([{ packageVersionId: "npm:lib-e@1.0.0", parentId: "npm:lib-c@1.0.0", range: "^1.0.0", toVersion: "2.0.0" }]);
    });

    it("returns 404 for an unknown plan", async () => {
        await expect(setup({ findings: [] }).service.validatePlan("plan_0123456789abcdef")).rejects.toMatchObject({ statusCode: 404 });
    });
});