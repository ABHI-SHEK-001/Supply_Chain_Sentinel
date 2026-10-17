import { chunk, mapLimit } from "../../shared/concurrency.js";
import {
    normalizeVulnerability,
    osvBatchResponseSchema,
    osvVulnerabilitySchema,
    type NormalizedVulnerability,
    type OsvPackageQuery,
    type PackageLookup,
    type VulnerabilityFetch,
} from "./osv.types.js";

const DEFAULT_BASE_URL = "https://api.osv.dev";
const MAX_PAGES = 100;
const MAX_BACKOFF_MS = 30_000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export type OsvErrorKind = "http" | "network" | "timeout" | "not_found" | "invalid_response";

export class OsvError extends Error {
    readonly kind: OsvErrorKind;
    readonly status: number | undefined;
    constructor(kind: OsvErrorKind, message: string, status?: number) {
        super(message);
        this.name = "OsvError";
        this.kind = kind;
        this.status = status;
    }
}

export interface OsvClientOptions {
    timeoutMs: number;
    /** Max concurrent HTTP calls (batches and vulnerability fetches). */
    concurrency: number;
    baseUrl?: string;
    maxRetries?: number;
    batchSize?: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class OsvClient {
    private readonly timeoutMs: number;
    private readonly concurrency: number;
    private readonly baseUrl: string;
    private readonly maxRetries: number;
    private readonly batchSize: number;
    private readonly fetchImpl: typeof fetch;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly random: () => number;

    constructor(options: OsvClientOptions) {
        this.timeoutMs = options.timeoutMs;
        this.concurrency = options.concurrency;
        this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
        this.maxRetries = options.maxRetries ?? 3;
        this.batchSize = options.batchSize ?? 500;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        this.random = options.random ?? Math.random;
    }

    /**
     * Looks up vulnerability ids per package version. Result order matches input order.
     * A package is `ok` only when every page of its results was retrieved; any transient
     * failure yields `failed` for it, never an empty `ok`.
     */
    async queryPackages(packages: readonly OsvPackageQuery[]): Promise<PackageLookup[]> {
        const batches = chunk(packages, this.batchSize);
        const results = await mapLimit(batches, this.concurrency, (batch) => this.queryBatch(batch));
        return results.flat();
    }

    async getVulnerability(id: string): Promise<NormalizedVulnerability> {
        const json = await this.request(`/v1/vulns/${encodeURIComponent(id)}`, { method: "GET" });
        const parsed = osvVulnerabilitySchema.safeParse(json);
        if (!parsed.success) {
            throw new OsvError("invalid_response", `OSV record for ${id} failed validation`);
        }
        return normalizeVulnerability(parsed.data);
    }

    async getVulnerabilities(ids: readonly string[]): Promise<Map<string, VulnerabilityFetch>> {
        const entries = await mapLimit(ids, this.concurrency, async (id): Promise<[string, VulnerabilityFetch]> => {
            try {
                return [id, { status: "ok", vulnerability: await this.getVulnerability(id) }];
            } catch (err) {
                return [id, { status: "failed", error: errorMessage(err) }];
            }
        });
        return new Map(entries);
    }

    private async queryBatch(batch: readonly OsvPackageQuery[]): Promise<PackageLookup[]> {
        const found: Array<Set<string>> = batch.map(() => new Set<string>());
        let pending: Array<{ index: number; token: string | undefined }> = batch.map((_, index) => ({
            index,
            token: undefined,
        }));
        let failure: string | undefined;

        for (let page = 0; pending.length > 0 && page < MAX_PAGES; page++) {
            const queries = pending.map(({ index, token }) => {
                const q = batch[index] as OsvPackageQuery;
                return {
                    package: { name: q.name, ecosystem: q.ecosystem },
                    version: q.version,
                    ...(token !== undefined ? { page_token: token } : {}),
                };
            });

            let results: Array<{ vulns?: Array<{ id: string }> | undefined; next_page_token?: string | undefined }>;
            try {
                const json = await this.request("/v1/querybatch", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ queries }),
                });
                const parsed = osvBatchResponseSchema.safeParse(json);
                if (!parsed.success) throw new OsvError("invalid_response", "OSV batch response failed validation");
                if (parsed.data.results.length !== pending.length) {
                    throw new OsvError("invalid_response", "OSV batch response length does not match the request");
                }
                results = parsed.data.results;
            } catch (err) {
                failure = errorMessage(err);
                break;
            }

            const next: typeof pending = [];
            results.forEach((result, i) => {
                const entry = pending[i] as { index: number };
                const bucket = found[entry.index] as Set<string>;
                for (const v of result.vulns ?? []) bucket.add(v.id);
                if (result.next_page_token) next.push({ index: entry.index, token: result.next_page_token });
            });
            pending = next;
        }

        if (pending.length > 0 && failure === undefined) failure = "OSV pagination limit exceeded";
        const incomplete = new Set(pending.map((p) => p.index));
        return batch.map((_, index): PackageLookup =>
            incomplete.has(index)
                ? { status: "failed", error: failure ?? "incomplete OSV results" }
                : { status: "ok", vulnIds: [...(found[index] as Set<string>)].sort() },
        );
    }

    private backoffMs(attempt: number): number {
        return Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt) * (0.5 + this.random() * 0.5);
    }

    private retryAfterMs(res: Response): number | undefined {
        const seconds = Number(res.headers.get("retry-after"));
        return Number.isFinite(seconds) && seconds > 0 ? Math.min(MAX_BACKOFF_MS, seconds * 1000) : undefined;
    }

    private async request(path: string, init: RequestInit): Promise<unknown> {
        const url = `${this.baseUrl}${path}`;
        for (let attempt = 0; ; attempt++) {
            let res: Response;
            let json: unknown;
            try {
                res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
                if (res.ok) json = await res.json();
            } catch (err) {
                if (err instanceof SyntaxError) throw new OsvError("invalid_response", "OSV returned invalid JSON");
                const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
                if (attempt >= this.maxRetries) {
                    throw timedOut
                        ? new OsvError("timeout", `OSV request timed out after ${this.timeoutMs}ms`)
                        : new OsvError("network", `OSV request failed: ${errorMessage(err)}`);
                }
                await this.sleep(this.backoffMs(attempt));
                continue;
            }

            if (res.ok) return json;
            await res.arrayBuffer().catch(() => undefined); // release the connection
            if (res.status === 404) throw new OsvError("not_found", "OSV resource not found", 404);
            if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
                await this.sleep(this.retryAfterMs(res) ?? this.backoffMs(attempt));
                continue;
            }
            throw new OsvError("http", `OSV responded with HTTP ${res.status}`, res.status);
        }
    }
}