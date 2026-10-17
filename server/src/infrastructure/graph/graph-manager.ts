import type { Graph } from "falkordb";
import type { GraphClient } from "./falkordb-client.js";
import { applyInitialGraphSchema } from "./migrations/001-initial-graph-schema.js";
import { serviceUnavailable } from "../../shared/errors/app-error.js";
import { logger } from "../../shared/logging/logger.js";

export type GraphParams = NonNullable<NonNullable<Parameters<Graph["query"]>[1]>["params"]>;

export class GraphManager {
    private ready: Promise<void> | undefined;

    constructor(
        private readonly client: GraphClient,
        private readonly graphName: string,
    ) { }

    private async graph(): Promise<Graph> {
        try {
            const db = await this.client.getDb();
            return db.selectGraph(this.graphName);
        } catch (err) {
            logger.warn("Graph connection failed", {
                message: err instanceof Error ? err.message : String(err),
            });
            throw serviceUnavailable("Graph database is unavailable");
        }
    }

    /** Connects and applies the schema once; retries on the next call if it failed. */
    async ensureReady(): Promise<void> {
        if (!this.ready) {
            this.ready = this.graph()
                .then((g) => applyInitialGraphSchema(g))
                .catch((err: unknown) => {
                    this.ready = undefined;
                    throw err;
                });
        }
        return this.ready;
    }

    /** Cypher must be a constant string; every variable goes through params. */
    async query<T = unknown>(cypher: string, params?: GraphParams) {
        await this.ensureReady();
        const g = await this.graph();
        return g.query<T>(cypher, params ? { params } : undefined);
    }

    async readQuery<T = unknown>(cypher: string, params?: GraphParams) {
        await this.ensureReady();
        const g = await this.graph();
        return g.roQuery<T>(cypher, params ? { params } : undefined);
    }

    /** Connectivity probe. GRAPH.LIST works before the graph exists. */
    async ping(): Promise<void> {
        const db = await this.client.getDb();
        await db.list();
    }

    async deleteGraph(): Promise<void> {
        const g = await this.graph();
        await g.delete();
        this.ready = undefined;
    }

    async close(): Promise<void> {
        await this.client.close();
    }
}