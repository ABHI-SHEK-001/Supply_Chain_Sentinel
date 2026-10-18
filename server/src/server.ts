import "dotenv/config";
import { createApp } from "./app.js";
import { parseEnv, type Env } from "./config/env.js";
import { logger } from "./shared/logging/logger.js";
import { createGraphClient } from "./infrastructure/graph/falkordb-client.js";
import { GraphManager } from "./infrastructure/graph/graph-manager.js";
import { DependencyIngestionService } from "./modules/ingestion/dependency-ingestion.service.js";
import { RepositoryService } from "./modules/repositories/repository.service.js";
import { GraphAnalysisService } from "./modules/graph-analysis/graph-analysis.service.js";

let env: Env;
try {
    env = parseEnv(process.env);
} catch (err) {
    logger.error("Startup failed", { message: err instanceof Error ? err.message : String(err) });
    process.exit(1);
}

const graph = new GraphManager(createGraphClient(env), env.GRAPH_NAME);
const repositoryService = new RepositoryService(graph, new DependencyIngestionService(graph));
const graphAnalysisService = new GraphAnalysisService(graph);
const app = createApp({
    env,
    graphHealth: () => graph.ping(),
    repositoryService,
    graphAnalysisService,
});
const HOST = "127.0.0.1";

const server = app.listen(env.PORT, HOST, () => {
    logger.info("API listening", { host: HOST, port: env.PORT, nodeEnv: env.NODE_ENV });
});

server.on("error", (err) => {
    logger.error("Server error", { message: err.message });
    process.exit(1);
});


const cleanups: Array<() => Promise<void>> = [() => graph.close()];

export function onShutdown(fn: () => Promise<void>): void {
    cleanups.push(fn);
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });

    const force = setTimeout(() => {
        logger.error("Forced exit after shutdown timeout");
        process.exit(1);
    }, 10000);
    force.unref();

    await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
    });
    for (const fn of cleanups) {
        try {
            await fn();
        } catch (err) {
            logger.error("Cleanup failed", { message: err instanceof Error ? err.message : String(err) });
        }
    }
    process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));