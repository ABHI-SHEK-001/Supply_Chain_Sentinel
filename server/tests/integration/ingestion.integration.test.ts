import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGraphClient } from "../../src/infrastructure/graph/falkordb-client.js";
import { GraphManager } from "../../src/infrastructure/graph/graph-manager.js";
import { DependencyIngestionService } from "../../src/modules/ingestion/dependency-ingestion.service.js";
import { RepositoryService } from "../../src/modules/repositories/repository.service.js";

const enabled = process.env["FALKORDB_INTEGRATION"] === "1";
const fixture = readFileSync(new URL("../fixtures/npm/package-lock.v3.json", import.meta.url), "utf8");

describe.skipIf(!enabled)("repository ingestion (FalkorDB)", () => {
    const graphName = `sentinel_ingest_${Date.now()}`;
    let gm: GraphManager;
    let service: RepositoryService;

    beforeAll(() => {
        gm = new GraphManager(
            createGraphClient({ FALKORDB_HOST: "127.0.0.1", FALKORDB_PORT: 6379 }),
            graphName,
        );
        service = new RepositoryService(gm, new DependencyIngestionService(gm));
    });

    afterAll(async () => {
        await gm.deleteGraph().catch(() => { });
        await gm.close();
    });

    const count = async (cypher: string, params?: Record<string, string>) => {
        const res = await gm.readQuery<{ c: number }>(cypher, params);
        return res.data?.[0]?.c;
    };

    it("ingests the fixture into the expected graph shape", async () => {
        const out = await service.register({ name: "acme-web", ecosystem: "npm", lockfile: fixture });
        expect(out.repository.packageCount).toBe(7);
        expect(await count("MATCH (v:PackageVersion) RETURN count(v) AS c")).toBe(7);
        expect(await count("MATCH (p:Package) RETURN count(p) AS c")).toBe(6);
        expect(await count("MATCH ()-[r:VERSION_OF]->() RETURN count(r) AS c")).toBe(7);
        expect(await count("MATCH ()-[r:CONTAINS]->() RETURN count(r) AS c")).toBe(7);
        expect(await count("MATCH ()-[r:DEPENDS_ON]->() RETURN count(r) AS c")).toBe(5);
        expect(
            await count("MATCH (:Repository)-[c:CONTAINS {direct: true}]->() RETURN count(c) AS c"),
        ).toBe(3);
    });

    it("re-running the same ingestion creates no duplicates", async () => {
        await service.register({ name: "acme-web", ecosystem: "npm", lockfile: fixture });
        expect(await count("MATCH (r:Repository) RETURN count(r) AS c")).toBe(1);
        expect(await count("MATCH (v:PackageVersion) RETURN count(v) AS c")).toBe(7);
        expect(await count("MATCH ()-[r:CONTAINS]->() RETURN count(r) AS c")).toBe(7);
        expect(await count("MATCH ()-[r:DEPENDS_ON]->() RETURN count(r) AS c")).toBe(5);
    });

    it("shares package nodes across repositories but scopes dependency edges", async () => {
        await service.register({ name: "other-repo", ecosystem: "npm", lockfile: fixture });
        expect(await count("MATCH (v:PackageVersion) RETURN count(v) AS c")).toBe(7);
        expect(await count("MATCH ()-[r:DEPENDS_ON]->() RETURN count(r) AS c")).toBe(10);
        expect(
            await count("MATCH ()-[d:DEPENDS_ON {repositoryId: $r}]->() RETURN count(d) AS c", {
                r: "repo:acme-web",
            }),
        ).toBe(5);
    });

    it("removes relationships for dependencies dropped from the lockfile", async () => {
        const lock = JSON.parse(fixture);
        delete lock.packages[""].devDependencies;
        delete lock.packages["node_modules/dev-tool"];
        await service.register({ name: "acme-web", ecosystem: "npm", lockfile: JSON.stringify(lock) });
        expect(
            await count("MATCH (:Repository {id: $r})-[c:CONTAINS]->() RETURN count(c) AS c", {
                r: "repo:acme-web",
            }),
        ).toBe(6);
        expect(
            await count("MATCH (:Repository {id: $r})-[c:CONTAINS]->() RETURN count(c) AS c", {
                r: "repo:other-repo",
            }),
        ).toBe(7);
    });
});