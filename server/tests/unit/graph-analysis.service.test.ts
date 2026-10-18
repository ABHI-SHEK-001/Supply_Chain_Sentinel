import { describe, expect, it, vi } from "vitest";
import { GraphAnalysisService } from "../../src/modules/graph-analysis/graph-analysis.service.js";

const node = (id: string, name: string, version: string, direct = false, dev = false, checked = "2026-10-17T00:00:00.000Z") => ({
    id, ecosystem: "npm", name, version, direct, dev, optional: false, osvCheckedAt: checked,
});

const NODES = [
    node("npm:lib-a@1.0.0", "lib-a", "1.0.0", true),
    node("npm:lib-b@2.0.0", "lib-b", "2.0.0", true),
    node("npm:lib-c@1.0.0", "lib-c", "1.0.0"),
    node("npm:lib-c@2.0.0", "lib-c", "2.0.0"),
    node("npm:lib-d@1.1.0", "lib-d", "1.1.0"),
    node("npm:dev-tool@1.0.0", "dev-tool", "1.0.0", true, true),
];
const EDGES = [
    { src: "npm:lib-a@1.0.0", dst: "npm:lib-c@1.0.0", kind: "prod" },
    { src: "npm:lib-b@2.0.0", dst: "npm:lib-c@2.0.0", kind: "prod" },
    { src: "npm:lib-c@1.0.0", dst: "npm:lib-d@1.1.0", kind: "prod" },
    { src: "npm:lib-c@2.0.0", dst: "npm:lib-d@1.1.0", kind: "prod" },
];
const finding = (vuln: string, pv: string, sev: string | null, fixed: string[] | null = ["9.9.9"]) => ({
    vulnerabilityId: vuln, packageVersionId: pv, summary: `s-${vuln}`, severityLabel: sev,
    sourceUrl: `https://osv.dev/vulnerability/${vuln}`, detailsStatus: "complete", fixedVersions: fixed,
});

function setup(opts: { repoExists?: boolean; findings?: ReturnType<typeof finding>[]; nodes?: typeof NODES } = {}) {
    const graph = {
        query: vi.fn(),
        readQuery: vi.fn().mockImplementation(async (cypher: string, params?: Record<string, unknown>) => {
            if (cypher.includes("RETURN r.id AS id") && cypher.includes("Repository {id: $id}") && !cypher.includes("CONTAINS"))
                return { data: opts.repoExists === false ? [] : [{ id: params?.["id"] }] };
            if (cypher.includes("AS osvCheckedAt")) return { data: opts.nodes ?? NODES };
            if (cypher.includes("AS src")) return { data: EDGES };
            if (cypher.includes("AS vulnerabilityId")) {
                const all = opts.findings ?? [];
                return { data: params?.["vulnerabilityId"] ? all.filter((f) => f.vulnerabilityId === params["vulnerabilityId"]) : all };
            }
            return { data: [] };
        }),
    };
    return { graph, service: new GraphAnalysisService(graph, () => new Date("2026-10-17T12:00:00.000Z")) };
}

describe("GraphAnalysisService.analyzeRepository", () => {
    it("returns 404 for an unknown repository", async () => {
        const { service } = setup({ repoExists: false });
        await expect(service.analyzeRepository("ghost")).rejects.toMatchObject({ statusCode: 404 });
    });

    it("reports direct, transitive and per-resolved-version paths", async () => {
        const { service } = setup({
            findings: [
                finding("V-direct", "npm:lib-a@1.0.0", "HIGH"),
                finding("V-c1", "npm:lib-c@1.0.0", "CRITICAL"),
                finding("V-d", "npm:lib-d@1.1.0", "LOW"),
            ],
        });
        const out = await service.analyzeRepository("demo");

        expect(out.findings.map((f) => f.vulnerability.id)).toEqual(["V-c1", "V-direct", "V-d"]); // severity order
        const byId = Object.fromEntries(out.findings.map((f) => [f.vulnerability.id, f]));

        expect(byId["V-direct"]).toMatchObject({ direct: true, entryPoints: ["npm:lib-a@1.0.0"], shortestPathLength: 0 });
        expect(byId["V-direct"]!.paths).toEqual([{ length: 0, devOnly: false, nodes: ["npm:lib-a@1.0.0"] }]);

        // lib-c@1.0.0 is reached only through lib-a - lib-b resolves to lib-c@2.0.0
        expect(byId["V-c1"]!.paths.map((p) => p.nodes)).toEqual([["npm:lib-a@1.0.0", "npm:lib-c@1.0.0"]]);
        expect(byId["V-c1"]!.affected).toMatchObject({ name: "lib-c", version: "1.0.0", fixedVersions: ["9.9.9"] });

        // lib-d is shared: two paths of length 2
        expect(byId["V-d"]!.paths.map((p) => p.nodes)).toEqual([
            ["npm:lib-a@1.0.0", "npm:lib-c@1.0.0", "npm:lib-d@1.1.0"],
            ["npm:lib-b@2.0.0", "npm:lib-c@2.0.0", "npm:lib-d@1.1.0"],
        ]);
        expect(byId["V-d"]!.entryPoints).toEqual(["npm:lib-a@1.0.0", "npm:lib-b@2.0.0"]);

        expect(out.summary).toEqual({
            findingCount: 3,
            vulnerabilityCount: 3,
            directlyAffectedCount: 1,
            bySeverity: { CRITICAL: 1, HIGH: 1, LOW: 1 },
        });
    });

    it("marks paths that start at a dev-only dependency", async () => {
        const { service } = setup({ findings: [finding("V-dev", "npm:dev-tool@1.0.0", "LOW")] });
        const out = await service.analyzeRepository("demo");
        expect(out.findings[0]!.paths[0]).toMatchObject({ devOnly: true, length: 0 });
    });

    it("scopes every read to the repository and passes ids as parameters", async () => {
        const { graph, service } = setup({ findings: [finding("V-d", "npm:lib-d@1.1.0", "LOW")] });
        await service.analyzeRepository("demo", { vulnerabilityId: "V-d" });
        for (const [cypher, params] of graph.readQuery.mock.calls as Array<[string, Record<string, string>]>) {
            expect(cypher).not.toContain("demo");
            expect(cypher).not.toContain("V-d");
            expect(params["id"]).toBe("repo:demo");
        }
        const edgeCall = (graph.readQuery.mock.calls as Array<[string, unknown]>).find(([c]) => c.includes("AS src"))!;
        expect(edgeCall[0]).toContain("DEPENDS_ON {repositoryId: $id}");
    });

    it("reports coverage so an unscanned repository is never read as clean", async () => {
        const unscanned = NODES.map((n) => ({ ...n, osvCheckedAt: null as unknown as string }));
        const { service } = setup({ nodes: unscanned });
        const out = await service.analyzeRepository("demo");
        expect(out.findings).toEqual([]);
        expect(out.coverage).toEqual({
            packagesTotal: 6, packagesChecked: 0, packagesUnchecked: 6, lastCheckedAt: null, complete: false,
        });

        const { service: s2 } = setup();
        expect((await s2.analyzeRepository("demo")).coverage).toMatchObject({ complete: true, packagesChecked: 6 });
    });

    it("surfaces truncation per finding and keeps unavailable fix data as null", async () => {
        const { service } = setup({ findings: [finding("V-d", "npm:lib-d@1.1.0", null, null)] });
        const out = await service.analyzeRepository("demo", { maxPathsPerFinding: 1 });
        const f = out.findings[0]!;
        expect(f.paths).toHaveLength(1);
        expect(f.pathsTruncated).toBe(true);
        expect(f.truncation).toBe("path_limit");
        expect(f.entryPoints).toHaveLength(2); // exact even when paths are capped
        expect(f.affected.fixedVersions).toBeNull();
        expect(out.summary.bySeverity).toEqual({ UNKNOWN: 1 });
    });
});

describe("GraphAnalysisService.getGraph", () => {
    it("returns nodes, edges and vulnerability markers, and truncates explicitly", async () => {
        const { service } = setup({ findings: [finding("V-d", "npm:lib-d@1.1.0", "LOW")] });
        const full = await service.getGraph("demo");
        expect(full).toMatchObject({ totalNodes: 6, totalEdges: 4, truncated: false });
        expect(full.nodes.find((n) => n.id === "npm:lib-d@1.1.0")!.vulnerabilityIds).toEqual(["V-d"]);
        expect(full.edges[0]).toEqual({ source: "npm:lib-a@1.0.0", target: "npm:lib-c@1.0.0", kind: "prod" });

        const small = await service.getGraph("demo", 2);
        expect(small.truncated).toBe(true);
        expect(small.nodes).toHaveLength(2);
        expect(small.totalNodes).toBe(6);
        const ids = new Set(small.nodes.map((n) => n.id));
        expect(small.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    });
});

describe("GraphAnalysisService vulnerability views", () => {
    it("groups findings across repositories and sorts by severity then spread", async () => {
        const rows = [
            { id: "V-low", summary: "l", severityLabel: "LOW", sourceUrl: null, detailsStatus: "complete", aliases: null, repositoryId: "repo:a", packageVersionId: "pv1" },
            { id: "V-high", summary: "h", severityLabel: "HIGH", sourceUrl: null, detailsStatus: "complete", aliases: ["CVE-1"], repositoryId: "repo:a", packageVersionId: "pv1" },
            { id: "V-high", summary: "h", severityLabel: "HIGH", sourceUrl: null, detailsStatus: "complete", aliases: ["CVE-1"], repositoryId: "repo:b", packageVersionId: "pv1" },
            { id: "V-high", summary: "h", severityLabel: "HIGH", sourceUrl: null, detailsStatus: "complete", aliases: ["CVE-1"], repositoryId: "repo:b", packageVersionId: "pv2" },
        ];
        const graph = { query: vi.fn(), readQuery: vi.fn().mockResolvedValue({ data: rows }) };
        const out = await new GraphAnalysisService(graph).listVulnerabilities(10);
        expect(out.total).toBe(2);
        expect(out.items.map((i) => i.id)).toEqual(["V-high", "V-low"]);
        expect(out.items[0]).toMatchObject({ repositoryCount: 2, packageVersionCount: 2, repositories: ["a", "b"], aliases: ["CVE-1"] });
        expect((await new GraphAnalysisService(graph).listVulnerabilities(1)).items).toHaveLength(1);
    });

    it("returns 404 for an unknown vulnerability and parses stored severity JSON", async () => {
        const miss = { query: vi.fn(), readQuery: vi.fn().mockResolvedValue({ data: [] }) };
        await expect(new GraphAnalysisService(miss).getVulnerability("NOPE")).rejects.toMatchObject({ statusCode: 404 });

        const record = {
            id: "V-1", summary: "s", details: "d", aliases: null, severityLabel: "HIGH",
            severityJson: '[{"type":"CVSS_V3","score":"CVSS:3.1/AV:N"}]', published: null, modified: null,
            withdrawn: null, references: null, sourceUrl: "u", detailsStatus: "complete", lastCheckedAt: null,
        };
        const graph = {
            query: vi.fn(),
            readQuery: vi.fn().mockImplementation(async (cypher: string) => {
                if (cypher.includes("x.details AS details")) return { data: [record] };
                return { data: [] }; // no affected repositories
            }),
        };
        const out = await new GraphAnalysisService(graph).getVulnerability("V-1");
        expect(out.vulnerability.severity).toEqual([{ type: "CVSS_V3", score: "CVSS:3.1/AV:N" }]);
        expect(out.vulnerability.aliases).toEqual([]);
        expect(out.repositories).toEqual([]);
    });
});