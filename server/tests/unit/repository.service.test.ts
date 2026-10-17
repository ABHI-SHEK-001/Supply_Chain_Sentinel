import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { RepositoryService } from "../../src/modules/repositories/repository.service.js";
import { AppError } from "../../src/shared/errors/app-error.js";

const fixture = readFileSync(new URL("../fixtures/npm/package-lock.v3.json", import.meta.url), "utf8");

const row = {
    id: "repo:acme-web",
    name: "acme-web",
    ecosystem: "npm",
    lockfileSha256: "abc",
    packageCount: 7,
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
};

function setup(rows: unknown[] = [row]) {
    const graph = {
        query: vi.fn(),
        readQuery: vi.fn().mockResolvedValue({ data: rows }),
    };
    const ingestion = {
        ingest: vi.fn().mockResolvedValue({
            repositoryId: "repo:acme-web",
            ingestionId: "x",
            packageCount: 7,
            dependencyEdgeCount: 5,
            directDependencyCount: 3,
        }),
    };
    return { graph, ingestion, service: new RepositoryService(graph, ingestion) };
}

describe("RepositoryService", () => {
    it("parses, hashes the raw lockfile, ingests, then returns the stored summary", async () => {
        const { ingestion, service } = setup();
        const out = await service.register({ name: "acme-web", ecosystem: "npm", lockfile: fixture });
        const call = ingestion.ingest.mock.calls[0]![0];
        expect(call.repositorySlug).toBe("acme-web");
        expect(call.lockfileSha256).toBe(createHash("sha256").update(fixture).digest("hex"));
        expect(call.parsed.packages).toHaveLength(7);
        expect(out.repository.id).toBe("acme-web");
        expect(out.repository.packageCount).toBe(7);
    });

    it("does not touch the graph when the lockfile is invalid or unsupported", async () => {
        const { graph, ingestion, service } = setup();
        await expect(
            service.register({ name: "x", ecosystem: "npm", lockfile: "{ nope" }),
        ).rejects.toMatchObject({ code: "INVALID_LOCKFILE" });
        await expect(
            service.register({ name: "x", ecosystem: "npm", lockfile: JSON.stringify({ lockfileVersion: 1 }) }),
        ).rejects.toMatchObject({ code: "UNSUPPORTED_LOCKFILE" });
        expect(ingestion.ingest).not.toHaveBeenCalled();
        expect(graph.readQuery).not.toHaveBeenCalled();
    });

    it("lists repositories with slug ids", async () => {
        const { service } = setup();
        expect((await service.list()).map((r) => r.id)).toEqual(["acme-web"]);
    });

    it("returns 404 for an unknown repository and passes the id as a parameter", async () => {
        const { graph, service } = setup([]);
        const err = await service.get("ghost").catch((e) => e);
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(404);
        expect(graph.readQuery.mock.calls[0]![1]).toEqual({ id: "repo:ghost" });
    });
});