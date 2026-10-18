import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGraphClient } from "../../src/infrastructure/graph/falkordb-client.js";
import { GraphManager } from "../../src/infrastructure/graph/graph-manager.js";
import { DependencyIngestionService } from "../../src/modules/ingestion/dependency-ingestion.service.js";
import { RemediationService } from "../../src/modules/remediation/remediation.service.js";
import { RepositoryService } from "../../src/modules/repositories/repository.service.js";
import type {
    NormalizedVulnerability,
    OsvPackageQuery,
    PackageLookup,
    VulnerabilityFetch,
} from "../../src/modules/vulnerabilities/osv.types.js";
import { VulnerabilityService } from "../../src/modules/vulnerabilities/vulnerability.service.js";

const enabled = process.env["FALKORDB_INTEGRATION"] === "1";
const fixture = readFileSync(new URL("../fixtures/npm/package-lock.v3.json", import.meta.url), "utf8");

function vuln(id: string, pkg: string, fixed: string): NormalizedVulnerability {
    return {
        id,
        aliases: [],
        summary: `simulated ${id}`,
        details: null,
        published: null,
        modified: null,
        withdrawn: null,
        severityLabel: "HIGH",
        severityJson: null,
        references: [],
        affected: [
            {
                ecosystem: "npm",
                name: pkg,
                fixedVersions: [fixed],
                ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed }] }],
            },
        ],
        sourceUrl: `https://osv.dev/vulnerability/${id}`,
    };
}

const CATALOG: Record<string, NormalizedVulnerability> = {
    "GHSA-direct": vuln("GHSA-direct", "lib-a", "1.0.1"),
    "OSV-d": vuln("OSV-d", "lib-d", "1.2.0"),
    "OSV-d2": vuln("OSV-d2", "lib-d", "1.1.5"),
    "GHSA-major": vuln("GHSA-major", "lib-c", "2.0.0"),
};
const BY_PACKAGE: Record<string, string[]> = {
    "lib-a@1.0.0": ["GHSA-direct"],
    "lib-c@1.0.0": ["GHSA-major"],
    "lib-d@1.1.0": ["OSV-d", "OSV-d2"],
};

const fakeOsv = {
    queryPackages: async (qs: readonly OsvPackageQuery[]): Promise<PackageLookup[]> =>
        qs.map((q): PackageLookup => ({ status: "ok", vulnIds: BY_PACKAGE[`${q.name}@${q.version}`] ?? [] })),
    getVulnerabilities: async (ids: readonly string[]): Promise<Map<string, VulnerabilityFetch>> =>
        new Map(
            ids.map((id): [string, VulnerabilityFetch] => [
                id,
                { status: "ok", vulnerability: CATALOG[id] as NormalizedVulnerability },
            ]),
        ),
};

describe.skipIf(!enabled)("remediation planning (FalkorDB)", () => {
    const graphName = `sentinel_plan_${Date.now()}`;
    let gm: GraphManager;
    let repos: RepositoryService;
    let service: RemediationService;

    beforeAll(async () => {
        gm = new GraphManager(
            createGraphClient({ FALKORDB_HOST: "127.0.0.1", FALKORDB_PORT: 6379 }),
            graphName,
        );
        repos = new RepositoryService(gm, new DependencyIngestionService(gm));
        await repos.register({ name: "demo", ecosystem: "npm", lockfile: fixture });
        await new VulnerabilityService(gm, fakeOsv).scanRepository("demo");
        service = new RemediationService(gm, fakeOsv);
    });

    afterAll(async () => {
        await gm.deleteGraph().catch(() => { });
        await gm.close();
    });

    const count = async (cypher: string) => (await gm.readQuery<{ c: number }>(cypher)).data?.[0]?.c;

    it("builds a minimal verified plan from real graph data", async () => {
        const plan = await service.generatePlan({ repositoryId: "demo" });
        expect(plan).toMatchObject({ status: "proposed", optimality: "exact", uncovered: [] });
        expect(plan.targeted).toMatchObject({ findingCount: 4, vulnerabilityCount: 4 });
        expect(plan.upgrades).toHaveLength(3); // 4 findings, 3 upgrades: two advisories share lib-d

        const byName = Object.fromEntries(plan.upgrades.map((u) => [u.name, u]));
        expect(byName["lib-a"]).toMatchObject({ toVersion: "1.0.1", kind: "direct", parentCompatibility: { status: "compatible" } });
        // 1.1.5 clears OSV-d2 only; 1.2.0 clears both, so it is the single valid upgrade
        expect(byName["lib-d"]).toMatchObject({ toVersion: "1.2.0", kind: "transitive", majorBump: false, parentCompatibility: { status: "compatible" } });
        expect(byName["lib-d"]!.eliminates.map((e) => e.vulnerabilityId).sort()).toEqual(["OSV-d", "OSV-d2"]);
        // lib-a declares ^1.0.0 for lib-c, so a 2.0.0 fix needs an override or a parent upgrade
        expect(byName["lib-c"]).toMatchObject({ toVersion: "2.0.0", majorBump: true, parentCompatibility: { status: "incompatible" } });
        expect(byName["lib-c"]!.parentCompatibility.blockingParents).toEqual([{ parentId: "npm:lib-a@1.0.0", range: "^1.0.0" }]);
    });

    it("persists the plan idempotently with its graph relationships", async () => {
        const again = await service.generatePlan({ repositoryId: "demo" });
        expect(await count("MATCH (p:RemediationPlan) RETURN count(p) AS c")).toBe(1);
        expect(await count("MATCH ()-[r:HAS_PLAN]->() RETURN count(r) AS c")).toBe(1);
        expect(await count("MATCH ()-[r:UPGRADES]->() RETURN count(r) AS c")).toBe(3);
        expect(await count("MATCH ()-[r:TARGETS]->() RETURN count(r) AS c")).toBe(4);
        expect(again.id).toMatch(/^plan_[a-f0-9]{16}$/);
    });

    it("lists and reloads the stored plan", async () => {
        const list = await service.listPlans("demo");
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ repositoryId: "demo", status: "proposed", upgradeCount: 3, uncoveredCount: 0 });
        const loaded = await service.getPlan(list[0]!.id);
        expect(loaded.upgrades).toHaveLength(3);
        expect(loaded.validation).toBeNull();
        expect(await service.listPlans("someone-else")).toEqual([]);
        await expect(service.getPlan("plan_0000000000000000")).rejects.toMatchObject({ statusCode: 404 });
    });

    it("validates the plan against the current graph and saves the outcome", async () => {
        const plans = await service.listPlans("demo");
        expect(plans.length).toBeGreaterThan(0);
        const id = plans[0]!.id;
        const v = await service.validatePlan(id);
        expect(v).toMatchObject({ status: "valid", eliminatedFindings: 4, fullyResolvesTargets: true, notEliminated: [] });
        expect(v.parentRangeViolations).toEqual([
            { packageVersionId: "npm:lib-c@1.0.0", parentId: "npm:lib-a@1.0.0", range: "^1.0.0", toVersion: "2.0.0" },
        ]);
        expect((await service.getPlan(id)).validation?.status).toBe("valid");
        expect((await service.listPlans("demo"))[0]!.validationStatus).toBe("valid");
    });

    it("marks the plan stale after the lockfile changes", async () => {
        const plans = await service.listPlans("demo");
        expect(plans.length).toBeGreaterThan(0);
        const id = plans[0]!.id;
        const lock = JSON.parse(fixture);
        delete lock.packages[""].devDependencies;
        delete lock.packages["node_modules/dev-tool"];
        await repos.register({ name: "demo", ecosystem: "npm", lockfile: JSON.stringify(lock) });
        expect((await service.validatePlan(id)).status).toBe("stale");
    });
});