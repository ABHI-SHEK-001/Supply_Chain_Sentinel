import { Router } from "express";
import { logger } from "../shared/logging/logger.js";

export type GraphHealthCheck = () => Promise<void>;

export type GraphStatus =
    | { status: "not_configured" }
    | { status: "up"; latencyMs: number }
    | { status: "down"; error: string };

export interface HealthDeps {
    graphHealth?: GraphHealthCheck | undefined;
}

const PROBE_TIMEOUT_MS = 2000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("probe timed out")), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function probeGraph(check: GraphHealthCheck | undefined): Promise<GraphStatus> {
    if (!check) return { status: "not_configured" };
    const started = Date.now();
    try {
        await withTimeout(check(), PROBE_TIMEOUT_MS);
        return { status: "up", latencyMs: Date.now() - started };
    } catch (err) {
        logger.warn("Graph health probe failed", {
            message: err instanceof Error ? err.message : String(err),
        });
        return { status: "down", error: "graph database unreachable" };
    }
}

export function createHealthRouter(deps: HealthDeps): Router {
    const router = Router();

    // Liveness: the process is up. Never touches the graph.
    router.get("/health", (_req, res) => {
        res.json({
            success: true,
            data: { status: "ok", uptimeSeconds: Math.round(process.uptime()) },
        });
    });

    // Readiness: API availability and graph connectivity reported separately.
    router.get("/api/v1/health", async (_req, res) => {
        const graph = await probeGraph(deps.graphHealth);
        const degraded = graph.status === "down";
        res.status(degraded ? 503 : 200).json({
            success: !degraded,
            data: {
                status: degraded ? "degraded" : "ok",
                timestamp: new Date().toISOString(),
                uptimeSeconds: Math.round(process.uptime()),
                api: { status: "up" },
                graph,
            },
        });
    });

    return router;
}