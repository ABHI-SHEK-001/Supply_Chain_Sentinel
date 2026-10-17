import "dotenv/config";
import { parseEnv } from "../config/env.js";
import { createGraphClient } from "../infrastructure/graph/falkordb-client.js";
import { GraphManager } from "../infrastructure/graph/graph-manager.js";
import { repositoryIdSchema } from "../modules/repositories/repository.schemas.js";
import { OsvClient } from "../modules/vulnerabilities/osv.client.js";
import { VulnerabilityService } from "../modules/vulnerabilities/vulnerability.service.js";

async function main(): Promise<number> {
    const slug = repositoryIdSchema.safeParse(process.argv[2]);
    if (!slug.success) {
        console.error("Usage: npm run scan -- <repository-slug>");
        return 2;
    }
    const env = parseEnv(process.env);
    const graph = new GraphManager(createGraphClient(env), env.GRAPH_NAME);
    try {
        const osv = new OsvClient({ timeoutMs: env.OSV_TIMEOUT_MS, concurrency: env.OSV_CONCURRENCY });
        const summary = await new VulnerabilityService(graph, osv).scanRepository(slug.data);
        console.log(JSON.stringify(summary, null, 2));
        return summary.status === "complete" ? 0 : 1;
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        return 1;
    } finally {
        await graph.close();
    }
}

process.exitCode = await main();