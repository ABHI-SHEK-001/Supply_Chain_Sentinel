import { describe, expect, it, vi } from "vitest";
import { GraphManager } from "../../src/infrastructure/graph/graph-manager.js";
import { NODE_LABELS, packageVersionId } from "../../src/infrastructure/graph/schema.js";

function fakeClient() {
    const graph = {
        query: vi.fn().mockResolvedValue({ data: [] }),
        roQuery: vi.fn().mockResolvedValue({ data: [] }),
        createNodeRangeIndex: vi.fn().mockResolvedValue({}),
        constraintCreate: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
    };
    const db = { selectGraph: vi.fn().mockReturnValue(graph), list: vi.fn().mockResolvedValue([]) };
    const client = { getDb: vi.fn().mockResolvedValue(db), close: vi.fn().mockResolvedValue(undefined) };
    return { graph, db, client };
}

describe("GraphManager", () => {
    it("passes values as params and never interpolates them into the Cypher string", async () => {
        const { graph, client } = fakeClient();
        const gm = new GraphManager(client as never, "g");
        const evil = "x'}) DETACH DELETE n //";
        await gm.query("MERGE (n:Package {id: $id})", { id: evil });
        const [cypher, options] = graph.query.mock.calls[0]!;
        expect(cypher).toBe("MERGE (n:Package {id: $id})");
        expect(cypher).not.toContain(evil);
        expect(options).toEqual({ params: { id: evil } });
    });

    it("applies the schema once across several queries", async () => {
        const { graph, client } = fakeClient();
        const gm = new GraphManager(client as never, "g");
        await gm.query("RETURN 1");
        await gm.query("RETURN 2");
        expect(graph.createNodeRangeIndex).toHaveBeenCalledTimes(NODE_LABELS.length);
        expect(graph.constraintCreate).toHaveBeenCalledTimes(NODE_LABELS.length);
    });

    it("tolerates already-existing indexes/constraints but surfaces other errors", async () => {
        const a = fakeClient();
        a.graph.createNodeRangeIndex.mockRejectedValue(new Error("Attribute 'id' is already indexed"));
        await expect(new GraphManager(a.client as never, "g").ensureReady()).resolves.toBeUndefined();

        const b = fakeClient();
        b.graph.constraintCreate.mockRejectedValue(new Error("boom"));
        await expect(new GraphManager(b.client as never, "g").ensureReady()).rejects.toThrow("boom");
    });

    it("retries schema setup after a failure", async () => {
        const { graph, client } = fakeClient();
        graph.createNodeRangeIndex.mockRejectedValueOnce(new Error("connection lost"));
        const gm = new GraphManager(client as never, "g");
        await expect(gm.ensureReady()).rejects.toThrow("connection lost");
        await expect(gm.ensureReady()).resolves.toBeUndefined();
    });

    it("ping uses GRAPH.LIST and propagates failure", async () => {
        const { db, client } = fakeClient();
        const gm = new GraphManager(client as never, "g");
        await gm.ping();
        expect(db.list).toHaveBeenCalled();
        db.list.mockRejectedValueOnce(new Error("down"));
        await expect(gm.ping()).rejects.toThrow("down");
    });
});

describe("packageVersionId", () => {
    it("is stable and distinguishes versions", () => {
        expect(packageVersionId("npm", "lodash", "4.17.21")).toBe("npm:lodash@4.17.21");
        expect(packageVersionId("npm", "lodash", "4.17.20")).not.toBe(
            packageVersionId("npm", "lodash", "4.17.21"),
        );
    });
});