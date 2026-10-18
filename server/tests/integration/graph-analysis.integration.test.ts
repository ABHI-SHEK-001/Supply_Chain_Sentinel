import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGraphClient } from "../../src/infrastructure/graph/falkordb-client.js";
import { GraphManager } from "../../src/infrastructure/graph/graph-manager.js";
import { GraphAnalysisService } from "../../src/modules/graph-analysis/graph-analysis.service.js";
import { DependencyIngestionService } from "../../src/modules/ingestion/dependency-ingestion.service.js";
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

// A second application that shares lib-d@1.1.0 and @scope/util@1.2.0 with the fixture,
// but reaches lib-d directly (no lib-a / lib-c in between).
const OTHER_LOCKFILE = JSON.stringify({
    name: "other-app",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
        "": { name: "other-app", version: "1.0.0", dependencies: { "lib-d": "^1.0.0" } },
        "node_modules/@scope/util": { version: "1.2.0" },
        "node_modules/lib-d": { version: "1.1.0", dependencies: { "@scope/util": "^1.0.0" } },
    },
});

function vuln(id: string, pkg: string, severityLabel: string): NormalizedVulnerability {
    return {
        id,
        aliases: [],
        summary: `simulated ${id}`,
        details: null,
        published: null,
        modified: null,
        withdrawn: null,
        severityLabel,
        severityJson: null,
        references: [],
        affected: [
            {
                ecosystem: "npm",
                name: pkg,
                fixedVersions: ["9.9.9"],
                ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "9.9.9" }] }],
            },
        ],
        sourceUrl: `https://osv.dev/vulnerability/${id}`,
    };
}

const CATALOG: Record<string, NormalizedVulnerability> = {
    "GHSA-direct": vuln("GHSA-direct", "lib-a", "HIGH"),
    "GHSA-c1": vuln("GHSA-c1", "lib-c", "CRITICAL"),
    "OSV-d": vuln("OSV-d", "lib-d", "MODERATE"),
};
const BY_PACKAGE: Record<string, string[]> = {
    "lib-a@1.0.0": ["GHSA-direct"],
    "lib-c@1.0.0": ["GHSA-c1"],
    "lib-d@1.1.0": ["OSV-d"],
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

describe.skipIf(!enabled)("graph analysis (FalkorDB)", () => {
    const graphName = `sentinel_paths_${Date.now()}`;
    let gm: GraphManager;
    let analysis: GraphAnalysisService;

    beforeAll(async () => {
        gm = new GraphManager(
            createGraphClient({ FALKORDB_HOST: "127.0.0.1", FALKORDB_PORT: 6379 }),
            graphName,
        );
        const repos = new RepositoryService(gm, new DependencyIngestionService(gm));
        await repos.register({ name: "demo", ecosystem: "npm", lockfile: fixture });
        await repos.register({ name: "other", ecosystem: "npm", lockfile: OTHER_LOCKFILE });
        const scanner = new VulnerabilityService(gm, fakeOsv);
        await scanner.scanRepository("demo");
        await scanner.scanRepository("other");
        analysis = new GraphAnalysisService(gm);
    });

    afterAll(async () => {
        await gm.deleteGraph().catch(() => { });
        await gm.close();
    });

    it("finds direct, per-version and shared-dependency paths in the demo repository", async () => {
        const out = await analysis.analyzeRepository("demo");
        expect(out.coverage).toMatchObject({ packagesTotal: 7, packagesChecked: 7, complete: true });
        expect(out.findings.map((f) => f.vulnerability.id)).toEqual(["GHSA-c1", "GHSA-direct", "OSV-d"]);

        const byId = Object.fromEntries(out.findings.map((f) => [f.vulnerability.id, f]));
        expect(byId["GHSA-direct"]).toMatchObject({ direct: true, shortestPathLength: 0 });
        expect(byId["GHSA-direct"]!.affected.fixedVersions).toEqual(["9.9.9"]);

        // lib-c@1.0.0 is reachable only through lib-a; lib-b resolves to lib-c@2.0.0
        expect(byId["GHSA-c1"]!.paths.map((p) => p.nodes)).toEqual([["npm:lib-a@1.0.0", "npm:lib-c@1.0.0"]]);

        expect(byId["OSV-d"]!.paths.map((p) => p.nodes)).toEqual([
            ["npm:lib-a@1.0.0", "npm:lib-c@1.0.0", "npm:lib-d@1.1.0"],
            ["npm:lib-b@2.0.0", "npm:lib-c@2.0.0", "npm:lib-d@1.1.0"],
        ]);
        expect(byId["OSV-d"]!.truncation).toBeNull();
    });

    it("does not leak paths between repositories that share package nodes", async () => {
        const out = await analysis.analyzeRepository("other");
        expect(out.findings.map((f) => f.vulnerability.id)).toEqual(["OSV-d"]); // lib-a / lib-c are not in this repo
        expect(out.findings[0]!.direct).toBe(true);
        expect(out.findings[0]!.paths.map((p) => p.nodes)).toEqual([["npm:lib-d@1.1.0"]]);

        const view = await analysis.getGraph("other");
        expect(view).toMatchObject({ totalNodes: 2, totalEdges: 1 });
        expect(view.edges).toEqual([{ source: "npm:lib-d@1.1.0", target: "npm:@scope/util@1.2.0", kind: "prod" }]);
    });

    it("returns the demo graph with vulnerability markers and honors the node limit", async () => {
        const view = await analysis.getGraph("demo");
        expect(view).toMatchObject({ totalNodes: 7, totalEdges: 5, truncated: false });
        expect(view.nodes.find((n) => n.id === "npm:lib-d@1.1.0")!.vulnerabilityIds).toEqual(["OSV-d"]);
        const small = await analysis.getGraph("demo", 3);
        expect(small).toMatchObject({ truncated: true, totalNodes: 7 });
        expect(small.nodes).toHaveLength(3);
    });

    it("lists vulnerabilities across repositories and details them per repository", async () => {
        const list = await analysis.listVulnerabilities();
        expect(list.items.map((i) => i.id)).toEqual(["GHSA-c1", "GHSA-direct", "OSV-d"]);
        expect(list.items.find((i) => i.id === "OSV-d")).toMatchObject({
            repositoryCount: 2,
            repositories: ["demo", "other"],
        });

        const detail = await analysis.getVulnerability("OSV-d");
        expect(detail.vulnerability.severity).toBeNull();
        expect(detail.repositories.map((r) => r.repositoryId)).toEqual(["demo", "other"]);
        expect(detail.repositories[0]!.findings[0]!.paths).toHaveLength(2);
        expect(detail.repositories[1]!.findings[0]!.paths).toHaveLength(1);
    });

    it("returns 404 for unknown repositories and vulnerabilities", async () => {
        await expect(analysis.analyzeRepository("ghost")).rejects.toMatchObject({ statusCode: 404 });
        await expect(analysis.getVulnerability("NOPE")).rejects.toMatchObject({ statusCode: 404 });
    });
});