import { z } from "zod";

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CORS_ORIGIN: z.string().min(1).default("http://localhost:3000"),
    FALKORDB_HOST: z.string().min(1).default("127.0.0.1"),
    FALKORDB_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    GRAPH_NAME: z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "must start with a letter and contain only letters, digits, underscores")
        .default("sentinel"),
    OSV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(10000),
    OSV_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
    const result = envSchema.safeParse(source);
    if (!result.success) {
        const details = result.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ");
        throw new Error(`Invalid environment configuration: ${details}`);
    }
    return result.data;
}