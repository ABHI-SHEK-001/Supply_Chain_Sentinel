import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DependencyIngestionService } from "../../src/modules/ingestion/dependency-ingestion.service.js";
import type { ParsedLockfile } from "../../src/modules/ingestion/lockfile.types.js";
import { NpmLockfileParser } from "../../src/modules/ingestion/npm-lockfile.parser.js";

const fixture = readFileSync(new URL("../fixtures/npm/package-lock.v3.json", import.meta.url), "utf8");
const parsed = new NpmLockfileParser().parse(fixture);
const SHA = "a".repeat(64);
const fixedClock = () => new Date("2026-10-16T00:00:00.000Z");

function setup() {
    const graph = {
        query: vi.fn().mockResolvedValue({ data: [] }),
        readQuery: vi.fn().mockResolvedValue({ data: [] }),
    };
    return { graph, service: new DependencyIngestionService(graph, fixedClock) };
}

function containsUndefined(value: unknown): boolean {
    if (value === undefined) return true;
    if (Array.isArray(value)) return value.some(containsUndefined);
    if (value && typeof value === "object") return Object.values(value).some(containsUndefined);
    return false;
}

describe("DependencyIngestionService", () => {
    it("runs the writes in order and finishes with stale-relationship cleanup", async () => {
        const { graph, service } = setup();
        const result = await service.ingest({ repositorySlug: "acme-web", lockfileSha256: SHA, parsed });

        const calls = graph.query.mock.calls.map((c) => c[0] as string);
        expect(calls).toHaveLength(6);
        expect(calls[0]).toContain("MERGE (r:Repository {id: $id})");
        expect(calls[1]).toContain("MERGE (v:PackageVersion {id: p.id})");
        expect(calls[2]).toContain("MERGE (r)-[c:CONTAINS]->(v)");
        expect(calls[3]).toContain("MERGE (a)-[d:DEPENDS_ON {repositoryId: $repositoryId}]->(b)");
        expect(calls[4]).toContain("DELETE c");
        expect(calls[5]).toContain("DELETE d");

        expect(result).toEqual({
            repositoryId: "repo:acme-web",
            ingestionId: SHA,
            packageCount: 7,
            dependencyEdgeCount: 5,
            directDependencyCount: 3,
        });
    });

    it("never interpolates values into Cypher and sends no undefined params", async () => {
        const { graph, service } = setup();
        await service.ingest({ repositorySlug: "acme-web", lockfileSha256: SHA, parsed });
        for (const [cypher, params] of graph.query.mock.calls) {
            expect(cypher).not.toContain("acme-web");
            expect(cypher).not.toContain("lib-a");
            expect(cypher).not.toContain(SHA);
            expect(containsUndefined(params)).toBe(false);
        }
    });

    it("scopes DEPENDS_ON and stale cleanup to the repository", async () => {
        const { graph, service } = setup();
        await service.ingest({ repositorySlug: "acme-web", lockfileSha256: SHA, parsed });
        const [, edgeParams] = graph.query.mock.calls[3]!;
        expect(edgeParams).toMatchObject({ repositoryId: "repo:acme-web", ingestionId: SHA });
        const [, cleanupParams] = graph.query.mock.calls[5]!;
        expect(cleanupParams).toEqual({ repositoryId: "repo:acme-web", ingestionId: SHA });
    });

    it("is deterministic: identical input produces identical queries and params", async () => {
        const a = setup();
        const b = setup();
        await a.service.ingest({ repositorySlug: "x", lockfileSha256: SHA, parsed });
        await b.service.ingest({ repositorySlug: "x", lockfileSha256: SHA, parsed });
        expect(a.graph.query.mock.calls).toEqual(b.graph.query.mock.calls);
    });

    it("splits large lockfiles into bounded batches", async () => {
        const { graph, service } = setup();
        const big: ParsedLockfile = {
            ...parsed,
            packages: Array.from({ length: 1200 }, (_, i) => ({
                id: `npm:p${i}@1.0.0`,
                ecosystem: "npm" as const,
                name: `p${i}`,
                version: "1.0.0",
                direct: false,
                dev: false,
                optional: false,
                lockfilePaths: [`node_modules/p${i}`],
            })),
            edges: [],
            directDependencies: [],
        };
        await service.ingest({ repositorySlug: "big", lockfileSha256: SHA, parsed: big });
        // 1 repo + 3 package upserts + 3 contains + 0 edges + 2 cleanups
        expect(graph.query).toHaveBeenCalledTimes(9);
        const sizes = graph.query.mock.calls
            .filter((c) => (c[0] as string).includes("MERGE (pkg:Package"))
            .map((c) => (c[1] as { packages: unknown[] }).packages.length);
        expect(sizes).toEqual([500, 500, 200]);
    });

    it("propagates graph failures", async () => {
        const { graph, service } = setup();
        graph.query.mockRejectedValueOnce(new Error("graph down"));
        await expect(
            service.ingest({ repositorySlug: "x", lockfileSha256: SHA, parsed }),
        ).rejects.toThrow("graph down");
    });
});