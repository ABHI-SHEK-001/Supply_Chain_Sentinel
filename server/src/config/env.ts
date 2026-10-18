import { z } from "zod";

const emptyStringToUndefined = z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined));

const envSchema = z
    .object({
        NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
        HOST: z.string().min(1).optional(),
        PORT: z.coerce.number().int().min(1).max(65535).default(4000),
        CORS_ORIGIN: z
            .string()
            .min(1)
            .default("http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173"),
        FALKORDB_HOST: z.string().min(1).default("127.0.0.1"),
        FALKORDB_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
        FALKORDB_USERNAME: emptyStringToUndefined,
        FALKORDB_PASSWORD: emptyStringToUndefined,
        FALKORDB_TLS: z
            .union([z.boolean(), z.string()])
            .optional()
            .transform((val) => {
                if (typeof val === "boolean") return val;
                if (!val) return false;
                return val.toLowerCase() === "true" || val === "1";
            })
            .default(false),
        FALKORDB_URL: emptyStringToUndefined,
        GRAPH_NAME: z
            .string()
            .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "must start with a letter and contain only letters, digits, underscores")
            .default("sentinel"),
        OSV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(10000),
        OSV_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    })
    .superRefine((data, ctx) => {
        if (
            data.NODE_ENV === "production" &&
            data.FALKORDB_HOST === "127.0.0.1" &&
            !data.FALKORDB_URL &&
            process.env.FALKORDB_ALLOW_LOCALHOST !== "true"
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["FALKORDB_HOST"],
                message:
                    "In production, FALKORDB_HOST or FALKORDB_URL must be configured for hosted FalkorDB (hosted backend will not default to 127.0.0.1:6379)",
            });
        }
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