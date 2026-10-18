import "dotenv/config";
import { parseEnv } from "../config/env.js";
import { createGraphClient } from "../infrastructure/graph/falkordb-client.js";
import { GraphManager } from "../infrastructure/graph/graph-manager.js";

async function runVerification(): Promise<void> {
    console.log("==================================================");
    console.log("SupplyChain Sentinel — Graph Connection Verification");
    console.log("==================================================");

    // 1. Validate configuration
    let env;
    try {
        env = parseEnv(process.env);
        console.log("✓ Configuration loaded successfully:");
        console.log(`  - Target Graph: ${env.GRAPH_NAME}`);
        if (env.FALKORDB_URL) {
            const masked = env.FALKORDB_URL.replace(/(:\/\/[^:]+:)([^@]+)(@)/, "$1***$3");
            console.log(`  - Connection Mode: URL (${masked})`);
        } else {
            console.log(`  - Host: ${env.FALKORDB_HOST}:${env.FALKORDB_PORT}`);
            console.log(`  - TLS Enabled: ${env.FALKORDB_TLS ? "yes" : "no"}`);
            console.log(`  - Auth User: ${env.FALKORDB_USERNAME || "(default / none)"}`);
            console.log(`  - Password Set: ${env.FALKORDB_PASSWORD ? "yes (redacted)" : "no"}`);
        }
    } catch (err) {
        console.error("✗ Configuration error:", err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    // 2. Establish connection and ping
    const client = createGraphClient(env);
    const gm = new GraphManager(client, env.GRAPH_NAME);

    try {
        console.log("\nProbing database connection...");
        const t0 = performance.now();
        await gm.ping();
        const pingLatency = (performance.now() - t0).toFixed(1);
        console.log(`✓ Database connectivity confirmed (PING / GRAPH.LIST) [${pingLatency} ms]`);

        // 3. Schema & read-only query check on target graph
        console.log(`\nVerifying graph '${env.GRAPH_NAME}' access and read capability...`);
        const t1 = performance.now();
        const result = await gm.readQuery<{ ok: number }>("RETURN 1 AS ok");
        const queryLatency = (performance.now() - t1).toFixed(1);

        if (result.data?.[0]?.ok === 1) {
            console.log(`✓ Read-only query executed successfully [${queryLatency} ms]`);
            console.log(`✓ Target graph '${env.GRAPH_NAME}' is ready and accessible.`);
        } else {
            console.warn("⚠ Query returned unexpected payload:", result);
        }

        console.log("\n==================================================");
        console.log("VERIFICATION SUCCESSFUL: Ready for operation.");
        console.log("==================================================");
    } catch (err) {
        console.error("\n✗ Connection verification failed:");
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    } finally {
        await gm.close();
    }
}

void runVerification();
