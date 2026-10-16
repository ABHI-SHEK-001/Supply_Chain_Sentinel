import { FalkorDB } from "falkordb";
import type { Env } from "../../config/env.js";
import { logger } from "../../shared/logging/logger.js";

export interface GraphClient {
    getDb(): Promise<FalkorDB>;
    close(): Promise<void>;
}

export function createGraphClient(
    env: Pick<Env, "FALKORDB_HOST" | "FALKORDB_PORT">,
): GraphClient {
    let pending: Promise<FalkorDB> | undefined;

    return {
        getDb() {
            if (!pending) {
                pending = FalkorDB.connect({
                    socket: { host: env.FALKORDB_HOST, port: env.FALKORDB_PORT, connectTimeout: 3000 },
                })
                    .then((db) => {
                        db.on("error", (err: unknown) =>
                            logger.warn("FalkorDB client error", {
                                message: err instanceof Error ? err.message : String(err),
                            }),
                        );
                        return db;
                    })
                    .catch((err: unknown) => {
                        pending = undefined; // retry on next call
                        throw err;
                    });
            }
            return pending;
        },

        async close() {
            const p = pending;
            pending = undefined;
            if (!p) return;
            try {
                const db = await p;
                await db.close();
            } catch {
                // never connected or already closed
            }
        },
    };
}