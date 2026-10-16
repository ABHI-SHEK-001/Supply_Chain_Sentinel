import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGraphClient } from "../../src/infrastructure/graph/falkordb-client.js";
import { GraphManager } from "../../src/infrastructure/graph/graph-manager.js";

const enabled = process.env["FALKORDB_INTEGRATION"] === "1";

describe.skipIf(!enabled)("FalkorDB integration", () => {
    const name = `sentinel_test_${Date.now()}`;
    let gm: GraphManager;

    beforeAll(() => {
        gm = new GraphManager(createGraphClient({ FALKORDB_HOST: "127.0.0.1", FALKORDB_PORT: 6379 }), name);
    });

    afterAll(async () => {
        await gm.deleteGraph().catch(() => { });
        await gm.close();
    });

    it("pings the database", async () => {
        await expect(gm.ping()).resolves.toBeUndefined();
    });

    it("applies the schema twice without error", async () => {
        await gm.ensureReady();
        const second = new GraphManager(
            createGraphClient({ FALKORDB_HOST: "127.0.0.1", FALKORDB_PORT: 6379 }),
            name,
        );
        await expect(second.ensureReady()).resolves.toBeUndefined();
        await second.close();
    });

    it("MERGE on id is idempotent", async () => {
        const q = "MERGE (p:PackageVersion {id: $id}) SET p.name = $name RETURN p.id AS id";
        await gm.query(q, { id: "npm:a@1.0.0", name: "a" });
        await gm.query(q, { id: "npm:a@1.0.0", name: "a" });
        const res = await gm.readQuery<{ c: number }>(
            "MATCH (p:PackageVersion {id: $id}) RETURN count(p) AS c",
            { id: "npm:a@1.0.0" },
        );
        expect(res.data?.[0]?.c).toBe(1);
    });

    it("stores injection-looking input as a literal value", async () => {
        const evil = "x'}) DETACH DELETE n //";
        await gm.query("MERGE (p:Package {id: $id})", { id: evil });
        const res = await gm.readQuery<{ id: string }>(
            "MATCH (p:Package {id: $id}) RETURN p.id AS id",
            { id: evil },
        );
        expect(res.data?.[0]?.id).toBe(evil);
    });
});