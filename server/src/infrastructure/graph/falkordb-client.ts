import { FalkorDB, type FalkorDBOptions } from "falkordb";
import type { Env } from "../../config/env.js";
import { logger } from "../../shared/logging/logger.js";

export interface GraphClient {
    getDb(): Promise<FalkorDB>;
    close(): Promise<void>;
}

export type FalkorDbClientConfig = {
    FALKORDB_HOST: string;
    FALKORDB_PORT: number;
    FALKORDB_USERNAME?: string | undefined;
    FALKORDB_PASSWORD?: string | undefined;
    FALKORDB_TLS?: boolean | undefined;
    FALKORDB_URL?: string | undefined;
};

function redactCredentials(message: string): string {
    return message.replace(/(:\/\/[^:]+:)([^@]+)(@)/g, "$1***$3");
}

export function createGraphClient(env: FalkorDbClientConfig): GraphClient {
    let pending: Promise<FalkorDB> | undefined;

    return {
        getDb() {
            if (!pending) {
                let options: FalkorDBOptions;

                if (env.FALKORDB_URL) {
                    options = {
                        url: env.FALKORDB_URL,
                        socket: {
                            connectTimeout: 10000,
                        },
                    };
                } else {
                    options = {
                        socket: {
                            host: env.FALKORDB_HOST,
                            port: env.FALKORDB_PORT,
                            connectTimeout: 10000,
                            ...(env.FALKORDB_TLS ? { tls: true } : {}),
                        },
                        ...(env.FALKORDB_USERNAME ? { username: env.FALKORDB_USERNAME } : {}),
                        ...(env.FALKORDB_PASSWORD ? { password: env.FALKORDB_PASSWORD } : {}),
                    };
                }

                pending = FalkorDB.connect(options)
                    .then((db) => {
                        db.on("error", (err: unknown) => {
                            const rawMsg = err instanceof Error ? err.message : String(err);
                            logger.warn("FalkorDB client error", {
                                message: redactCredentials(rawMsg),
                            });
                        });
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