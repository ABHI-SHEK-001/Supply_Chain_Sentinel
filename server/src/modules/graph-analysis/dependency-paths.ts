// Pure path-search engine. Edge direction: `from` REQUIRES `to`.
// A path runs from a repository's direct dependency down to a target package version.

export interface PathGraphInput {
    nodeIds: readonly string[];
    directIds: readonly string[];
    edges: ReadonlyArray<{ from: string; to: string }>;
}

export interface PathGraph {
    readonly nodeIds: ReadonlySet<string>;
    readonly directIds: readonly string[];
    readonly dependsOn: ReadonlyMap<string, readonly string[]>;
    readonly dependedOnBy: ReadonlyMap<string, readonly string[]>;
}

export type PathTruncation = "path_limit" | "depth_limit" | "search_budget";

export interface PathSearchOptions {
    /** Hard bound on edges per path. */
    maxDepth: number;
    /** Max paths returned. */
    maxPaths: number;
    /** Max search steps (node expansions) per target. */
    maxSteps?: number;
}

export interface TargetExposure {
    targetId: string;
    reachable: boolean;
    /** Exact, never truncated: direct dependencies from which the target is reachable. */
    entryPoints: string[];
    shortestPathLength: number | null;
    /** Simple paths (no repeated node), shortest first, then lexicographic. */
    paths: string[][];
    truncation: PathTruncation | null;
}

export const DEFAULT_MAX_STEPS = 200_000;

function toSortedMap(source: Map<string, Set<string>>): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const [key, values] of source) out.set(key, [...values].sort());
    return out;
}

export function buildPathGraph(input: PathGraphInput): PathGraph {
    const nodeIds = new Set(input.nodeIds);
    const forward = new Map<string, Set<string>>();
    const reverse = new Map<string, Set<string>>();
    for (const { from, to } of input.edges) {
        if (from === to || !nodeIds.has(from) || !nodeIds.has(to)) continue;
        if (!forward.has(from)) forward.set(from, new Set());
        if (!reverse.has(to)) reverse.set(to, new Set());
        forward.get(from)?.add(to);
        reverse.get(to)?.add(from);
    }
    return {
        nodeIds,
        directIds: [...new Set(input.directIds.filter((id) => nodeIds.has(id)))].sort(),
        dependsOn: toSortedMap(forward),
        dependedOnBy: toSortedMap(reverse),
    };
}

export function findPathsToTarget(
    graph: PathGraph,
    targetId: string,
    options: PathSearchOptions,
): TargetExposure {
    const unreachable: TargetExposure = {
        targetId,
        reachable: false,
        entryPoints: [],
        shortestPathLength: null,
        paths: [],
        truncation: null,
    };
    if (!graph.nodeIds.has(targetId)) return unreachable;

    // Reverse BFS: dist = fewest edges from a node to the target.
    const dist = new Map<string, number>([[targetId, 0]]);
    const queue: string[] = [targetId];
    for (let i = 0; i < queue.length; i++) {
        const node = queue[i] as string;
        const d = dist.get(node) as number;
        for (const parent of graph.dependedOnBy.get(node) ?? []) {
            if (!dist.has(parent)) {
                dist.set(parent, d + 1);
                queue.push(parent);
            }
        }
    }

    const entryPoints = graph.directIds.filter((id) => dist.has(id));
    if (entryPoints.length === 0) return unreachable;
    const shortest = Math.min(...entryPoints.map((id) => dist.get(id) as number));

    const budget = options.maxSteps ?? DEFAULT_MAX_STEPS;
    let steps = 0;
    let aborted = false;
    const stack: string[] = [];
    const onPath = new Set<string>();

    // Enumerate simple paths of exactly `remaining` more edges ending at the target,
    // pruned with `dist` (a branch must still be able to reach the target in time).
    const walk = (node: string, remaining: number, sink: string[][], limit: number): void => {
        if (aborted || sink.length >= limit) return;
        if (++steps > budget) {
            aborted = true;
            return;
        }
        stack.push(node);
        onPath.add(node);
        if (remaining === 0) {
            if (node === targetId) sink.push([...stack]);
        } else if (node !== targetId) {
            for (const next of graph.dependsOn.get(node) ?? []) {
                if (aborted || sink.length >= limit) break;
                if (onPath.has(next)) continue;
                const d = dist.get(next);
                if (d === undefined || d > remaining - 1) continue;
                walk(next, remaining - 1, sink, limit);
            }
        }
        stack.pop();
        onPath.delete(node);
    };

    const cap = options.maxPaths;
    const paths: string[][] = [];
    for (let length = shortest; length <= options.maxDepth && paths.length <= cap && !aborted; length++) {
        for (const entry of entryPoints) {
            if ((dist.get(entry) as number) > length) continue;
            walk(entry, length, paths, cap + 1);
            if (paths.length > cap || aborted) break;
        }
    }

    let truncation: PathTruncation | null = null;
    if (paths.length > cap) {
        paths.length = cap;
        truncation = "path_limit";
    } else if (aborted) {
        truncation = "search_budget";
    } else {
        // Best-effort probe: is there any path just beyond the depth bound?
        const probe: string[][] = [];
        for (const entry of entryPoints) {
            walk(entry, options.maxDepth + 1, probe, 1);
            if (probe.length > 0 || aborted) break;
        }
        if (aborted) truncation = "search_budget";
        else if (probe.length > 0 || paths.length === 0) truncation = "depth_limit";
    }

    return {
        targetId,
        reachable: true,
        entryPoints,
        shortestPathLength: shortest,
        paths,
        truncation,
    };
}