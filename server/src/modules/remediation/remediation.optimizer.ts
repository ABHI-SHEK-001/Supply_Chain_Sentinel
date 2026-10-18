// Exact minimum-cost cover (branch and bound). Costs are vectors compared
// lexicographically, so earlier components dominate later ones.

export type CostVector = readonly number[];

export interface Candidate<T> {
    id: string;
    /** Element ids this candidate eliminates. */
    covers: readonly string[];
    cost: CostVector;
    payload: T;
}

export interface OptimizationResult<T> {
    selected: Array<Candidate<T>>;
    /** Elements no candidate can cover. */
    uncovered: string[];
    totalCost: number[];
    /** `exact`: proven minimum. `budget_exhausted`: best found within the search budget, not proven. */
    optimality: "exact" | "budget_exhausted";
    nodesExplored: number;
}

export interface OptimizerOptions {
    maxNodes?: number;
}

export const DEFAULT_MAX_NODES = 200_000;

const addCost = (a: readonly number[], b: readonly number[]): number[] => {
    const len = Math.max(a.length, b.length);
    return Array.from({ length: len }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));
};

/** Negative if a < b. */
export const compareCost = (a: readonly number[], b: readonly number[]): number => {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
};

export function solveMinimumCover<T>(
    elements: readonly string[],
    candidates: readonly Candidate<T>[],
    options: OptimizerOptions = {},
): OptimizationResult<T> {
    const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    const sorted = [...candidates].sort((a, b) => compareCost(a.cost, b.cost) || a.id.localeCompare(b.id));
    const universe = [...new Set(elements)].sort();

    const byElement = new Map<string, Array<Candidate<T>>>();
    for (const c of sorted) {
        for (const e of c.covers) {
            const list = byElement.get(e) ?? [];
            list.push(c);
            byElement.set(e, list);
        }
    }
    const uncovered = universe.filter((e) => (byElement.get(e) ?? []).length === 0);
    const coverable = universe.filter((e) => (byElement.get(e) ?? []).length > 0);

    // Incumbent: cheapest candidate per element (valid cover, maybe not minimal).
    let best: Array<Candidate<T>> = [];
    {
        const covered = new Set<string>();
        for (const e of coverable) {
            if (covered.has(e)) continue;
            const pick = (byElement.get(e) as Array<Candidate<T>>)[0] as Candidate<T>;
            best.push(pick);
            pick.covers.forEach((x) => covered.add(x));
        }
    }
    let bestCost: number[] = best.reduce<number[]>((sum, c) => addCost(sum, c.cost), []);

    let nodes = 0;
    let exhausted = false;

    const search = (remaining: Set<string>, chosen: Array<Candidate<T>>, cost: number[]): void => {
        if (exhausted) return;
        if (++nodes > maxNodes) {
            exhausted = true;
            return;
        }
        if (remaining.size === 0) {
            if (compareCost(cost, bestCost) < 0) {
                best = [...chosen];
                bestCost = cost;
            }
            return;
        }
        // Costs are non-negative, so a partial cost >= best can never improve.
        if (compareCost(cost, bestCost) >= 0) return;

        // Branch on the element with the fewest candidates.
        let pivot: string | undefined;
        let pivotCount = Infinity;
        for (const e of remaining) {
            const n = (byElement.get(e) as Array<Candidate<T>>).length;
            if (n < pivotCount || (n === pivotCount && pivot !== undefined && e < pivot)) {
                pivot = e;
                pivotCount = n;
            }
        }
        for (const c of byElement.get(pivot as string) as Array<Candidate<T>>) {
            const next = new Set(remaining);
            c.covers.forEach((x) => next.delete(x));
            chosen.push(c);
            search(next, chosen, addCost(cost, c.cost));
            chosen.pop();
            if (exhausted) return;
        }
    };
    search(new Set(coverable), [], []);

    return {
        selected: [...best].sort((a, b) => a.id.localeCompare(b.id)),
        uncovered,
        totalCost: bestCost,
        optimality: exhausted ? "budget_exhausted" : "exact",
        nodesExplored: nodes,
    };
}