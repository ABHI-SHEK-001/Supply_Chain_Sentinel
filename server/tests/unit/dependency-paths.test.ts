import { describe, expect, it } from "vitest";
import { buildPathGraph, findPathsToTarget } from "../../src/modules/graph-analysis/dependency-paths.js";

const edges = (...pairs: Array<[string, string]>) => pairs.map(([from, to]) => ({ from, to }));
const opts = { maxDepth: 10, maxPaths: 10 };

describe("findPathsToTarget", () => {
    it("finds a direct dependency as a zero-length path", () => {
        const g = buildPathGraph({ nodeIds: ["a", "b"], directIds: ["a"], edges: edges(["a", "b"]) });
        const r = findPathsToTarget(g, "a", opts);
        expect(r).toMatchObject({ reachable: true, entryPoints: ["a"], shortestPathLength: 0, truncation: null });
        expect(r.paths).toEqual([["a"]]);
    });

    it("finds a transitive path in order: direct dependency first, target last", () => {
        const g = buildPathGraph({
            nodeIds: ["a", "b", "c"],
            directIds: ["a"],
            edges: edges(["a", "b"], ["b", "c"]),
        });
        const r = findPathsToTarget(g, "c", opts);
        expect(r.paths).toEqual([["a", "b", "c"]]);
        expect(r.shortestPathLength).toBe(2);
        expect(r.truncation).toBeNull();
    });

    it("reports every entry point when several direct dependencies reach the target", () => {
        const g = buildPathGraph({
            nodeIds: ["a", "b", "x", "t"],
            directIds: ["a", "b", "x"],
            edges: edges(["a", "t"], ["b", "t"]),
        });
        const r = findPathsToTarget(g, "t", opts);
        expect(r.entryPoints).toEqual(["a", "b"]); // x does not reach t
        expect(r.paths).toEqual([["a", "t"], ["b", "t"]]);
    });

    it("enumerates repeated (diamond) paths and orders them shortest first", () => {
        const g = buildPathGraph({
            nodeIds: ["a", "b", "c", "d", "t"],
            directIds: ["a"],
            edges: edges(["a", "b"], ["a", "c"], ["b", "t"], ["c", "d"], ["d", "t"]),
        });
        const r = findPathsToTarget(g, "t", opts);
        expect(r.paths).toEqual([
            ["a", "b", "t"],
            ["a", "c", "d", "t"],
        ]);
    });

    it("returns both paths of a symmetric diamond", () => {
        const g = buildPathGraph({
            nodeIds: ["a", "b", "c", "t"],
            directIds: ["a"],
            edges: edges(["a", "b"], ["a", "c"], ["b", "t"], ["c", "t"]),
        });
        expect(findPathsToTarget(g, "t", opts).paths).toEqual([
            ["a", "b", "t"],
            ["a", "c", "t"],
        ]);
    });

    it("terminates on cycles and never repeats a node in a path", () => {
        const g = buildPathGraph({
            nodeIds: ["a", "b", "c", "t"],
            directIds: ["a"],
            edges: edges(["a", "b"], ["b", "c"], ["c", "a"], ["c", "b"], ["b", "t"]),
        });
        const r = findPathsToTarget(g, "t", opts);
        for (const p of r.paths) expect(new Set(p).size).toBe(p.length);
        expect(r.paths).toContainEqual(["a", "b", "t"]);
    });

    it("marks an unreachable or unknown target as not reachable", () => {
        const g = buildPathGraph({ nodeIds: ["a", "z"], directIds: ["a"], edges: [] });
        expect(findPathsToTarget(g, "z", opts)).toMatchObject({ reachable: false, entryPoints: [], paths: [] });
        expect(findPathsToTarget(g, "missing", opts).reachable).toBe(false);
    });

    it("truncates at maxPaths and says so, keeping the shortest paths", () => {
        // a -> m1..m5 -> t gives 5 paths of length 2, plus a long detour
        const mids = ["m1", "m2", "m3", "m4", "m5"];
        const g = buildPathGraph({
            nodeIds: ["a", "t", "u", ...mids],
            directIds: ["a"],
            edges: edges(...mids.flatMap((m): Array<[string, string]> => [["a", m], [m, "t"]]), ["a", "u"], ["u", "m1"]),
        });
        const r = findPathsToTarget(g, "t", { maxDepth: 10, maxPaths: 3 });
        expect(r.paths).toHaveLength(3);
        expect(r.paths.every((p) => p.length === 3)).toBe(true);
        expect(r.truncation).toBe("path_limit");
    });

    it("does not report truncation when all paths fit", () => {
        const g = buildPathGraph({
            nodeIds: ["a", "b", "c", "t"],
            directIds: ["a"],
            edges: edges(["a", "b"], ["a", "c"], ["b", "t"], ["c", "t"]),
        });
        expect(findPathsToTarget(g, "t", { maxDepth: 10, maxPaths: 2 }).truncation).toBeNull();
    });

    it("reports depth_limit when the only paths are deeper than maxDepth", () => {
        const g = buildPathGraph({
            nodeIds: ["a", "b", "c", "t"],
            directIds: ["a"],
            edges: edges(["a", "b"], ["b", "c"], ["c", "t"]),
        });
        const r = findPathsToTarget(g, "t", { maxDepth: 2, maxPaths: 10 });
        expect(r.paths).toEqual([]);
        expect(r.truncation).toBe("depth_limit");
        expect(r.entryPoints).toEqual(["a"]); // reachability stays exact
    });

    it("flags depth_limit when a longer path exists just beyond maxDepth", () => {
        const g = buildPathGraph({
            nodeIds: ["a", "b", "c", "t"],
            directIds: ["a"],
            edges: edges(["a", "t"], ["a", "b"], ["b", "c"], ["c", "t"]),
        });
        const r = findPathsToTarget(g, "t", { maxDepth: 2, maxPaths: 10 });
        expect(r.paths).toEqual([["a", "t"]]);
        expect(r.truncation).toBe("depth_limit"); // a length-3 path exists beyond maxDepth 2
    });

    it("reports no truncation when nothing exists beyond maxDepth", () => {
        const g = buildPathGraph({
            nodeIds: ["a", "b", "t"],
            directIds: ["a"],
            edges: edges(["a", "t"], ["a", "b"]),
        });
        const r = findPathsToTarget(g, "t", { maxDepth: 2, maxPaths: 10 });
        expect(r.paths).toEqual([["a", "t"]]);
        expect(r.truncation).toBeNull();
    });

    it("stops at the search budget instead of exploring forever", () => {
        // layered graph with many routes
        const layers = 8;
        const width = 4;
        const nodeIds = ["a", "t"];
        const pairs: Array<[string, string]> = [];
        let prev = ["a"];
        for (let l = 0; l < layers; l++) {
            const cur = Array.from({ length: width }, (_, i) => `n${l}_${i}`);
            nodeIds.push(...cur);
            for (const p of prev) for (const c of cur) pairs.push([p, c]);
            prev = cur;
        }
        for (const p of prev) pairs.push([p, "t"]);
        const g = buildPathGraph({ nodeIds, directIds: ["a"], edges: edges(...pairs) });
        const r = findPathsToTarget(g, "t", { maxDepth: 20, maxPaths: 1_000_000, maxSteps: 500 });
        expect(r.truncation).toBe("search_budget");
    });

    it("is deterministic", () => {
        const input = {
            nodeIds: ["a", "b", "c", "t"],
            directIds: ["a"],
            edges: edges(["a", "c"], ["a", "b"], ["c", "t"], ["b", "t"]),
        };
        const one = findPathsToTarget(buildPathGraph(input), "t", opts);
        const two = findPathsToTarget(buildPathGraph({ ...input, edges: [...input.edges].reverse() }), "t", opts);
        expect(two).toEqual(one);
    });

    it("ignores self-loops and edges to unknown nodes", () => {
        const g = buildPathGraph({ nodeIds: ["a", "t"], directIds: ["a"], edges: edges(["a", "a"], ["a", "ghost"], ["a", "t"]) });
        expect(findPathsToTarget(g, "t", opts).paths).toEqual([["a", "t"]]);
    });
});