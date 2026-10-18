import { describe, expect, it } from "vitest";
import { compareCost, solveMinimumCover, type Candidate } from "../../src/modules/remediation/remediation.optimizer.js";

const cand = (id: string, covers: string[], cost: number[] = [1]): Candidate<string> => ({ id, covers, cost, payload: id });

describe("solveMinimumCover", () => {
    it("finds the true minimum where a greedy choice would not", () => {
        // Greedy takes R (covers 4) first and then needs T and U: 3 sets. The optimum is P + Q: 2 sets.
        const out = solveMinimumCover(
            ["1", "2", "3", "4", "5", "6"],
            [cand("P", ["1", "2", "3"]), cand("Q", ["4", "5", "6"]), cand("R", ["1", "2", "4", "5"]), cand("T", ["3"]), cand("U", ["6"])],
        );
        expect(out.selected.map((c) => c.id)).toEqual(["P", "Q"]);
        expect(out.totalCost).toEqual([2]);
        expect(out.optimality).toBe("exact");
        expect(out.uncovered).toEqual([]);
    });

    it("minimizes lexicographically: count first, then later components", () => {
        // Two covers of the same element: one major bump (cost [1,1]) vs none ([1,0]).
        const out = solveMinimumCover(["x"], [cand("major", ["x"], [1, 1, 0]), cand("minor", ["x"], [1, 0, 2])]);
        expect(out.selected.map((c) => c.id)).toEqual(["minor"]);
        // fewer upgrades always beats fewer later-cost units
        const out2 = solveMinimumCover(["a", "b"], [cand("both", ["a", "b"], [1, 1, 5]), cand("a", ["a"], [1, 0, 0]), cand("b", ["b"], [1, 0, 0])]);
        expect(out2.selected.map((c) => c.id)).toEqual(["both"]);
        expect(out2.totalCost).toEqual([1, 1, 5]);
    });

    it("reports elements nothing can cover and still covers the rest", () => {
        const out = solveMinimumCover(["a", "b", "ghost"], [cand("A", ["a"]), cand("B", ["b"])]);
        expect(out.uncovered).toEqual(["ghost"]);
        expect(out.selected.map((c) => c.id)).toEqual(["A", "B"]);
    });

    it("handles empty input", () => {
        expect(solveMinimumCover([], [])).toMatchObject({ selected: [], uncovered: [], totalCost: [], optimality: "exact" });
    });

    it("returns a valid cover but says so when the search budget is exhausted", () => {
        const elements = Array.from({ length: 14 }, (_, i) => `e${i}`);
        const candidates = elements.flatMap((e, i) => [
            cand(`s${i}`, [e], [1]),
            cand(`p${i}`, [e, elements[(i + 1) % 14] as string], [1]),
        ]);
        const out = solveMinimumCover(elements, candidates, { maxNodes: 5 });
        expect(out.optimality).toBe("budget_exhausted");
        const covered = new Set(out.selected.flatMap((c) => c.covers));
        expect(elements.every((e) => covered.has(e))).toBe(true);
    });

    it("is deterministic regardless of input order", () => {
        const candidates = [cand("B", ["1", "2"]), cand("A", ["1", "2"]), cand("C", ["3"])];
        const one = solveMinimumCover(["1", "2", "3"], candidates);
        const two = solveMinimumCover(["3", "2", "1"], [...candidates].reverse());
        expect(two.selected.map((c) => c.id)).toEqual(one.selected.map((c) => c.id));
        expect(one.selected.map((c) => c.id)).toEqual(["A", "C"]);
    });

    it("compareCost is lexicographic", () => {
        expect(compareCost([1, 9], [2, 0])).toBeLessThan(0);
        expect(compareCost([1, 0], [1, 0])).toBe(0);
        expect(compareCost([1], [1, 1])).toBeLessThan(0);
    });
});