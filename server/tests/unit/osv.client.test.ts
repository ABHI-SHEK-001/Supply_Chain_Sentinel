import { describe, expect, it, vi } from "vitest";
import { OsvClient, OsvError } from "../../src/modules/vulnerabilities/osv.client.js";
import { normalizeVulnerability, osvVulnerabilitySchema } from "../../src/modules/vulnerabilities/osv.types.js";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function makeClient(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, extra = {}) {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn(fetchImpl);
    const client = new OsvClient({
        timeoutMs: 5000,
        concurrency: 2,
        maxRetries: 2,
        batchSize: 2,
        fetchImpl: fetchMock as unknown as typeof fetch,
        sleep,
        random: () => 1,
        ...extra,
    });
    return { client, fetchMock, sleep };
}

const pkg = (name: string, version = "1.0.0") => ({ ecosystem: "npm", name, version });
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body));

describe("OsvClient.queryPackages", () => {
    it("keeps input order, treats {} as 'confirmed none', and follows per-query page tokens", async () => {
        const { client, fetchMock } = makeClient(async (_url, init) => {
            const { queries } = bodyOf(init);
            if (queries.length === 2 && queries[0].page_token === undefined) {
                return json({ results: [{ vulns: [{ id: "GHSA-a" }], next_page_token: "t1" }, {}] });
            }
            // second round: only the query that returned a token, carrying that token
            expect(queries).toHaveLength(1);
            expect(queries[0].page_token).toBe("t1");
            expect(queries[0].package).toEqual({ name: "a", ecosystem: "npm" });
            return json({ results: [{ vulns: [{ id: "GHSA-b" }] }] });
        });
        const out = await client.queryPackages([pkg("a"), pkg("b")]);
        expect(out).toEqual([
            { status: "ok", vulnIds: ["GHSA-a", "GHSA-b"] },
            { status: "ok", vulnIds: [] },
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("splits into batches, preserves order, and bounds concurrency", async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const { client, fetchMock } = makeClient(
            async (_url, init) => {
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise((r) => setTimeout(r, 10));
                inFlight--;
                const { queries } = bodyOf(init);
                return json({ results: queries.map((q: { package: { name: string } }) => ({ vulns: [{ id: `V-${q.package.name}` }] })) });
            },
            { concurrency: 2, batchSize: 1 },
        );
        const names = ["a", "b", "c", "d", "e"];
        const out = await client.queryPackages(names.map((n) => pkg(n)));
        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect(maxInFlight).toBeLessThanOrEqual(2);
        expect(out.map((r) => (r.status === "ok" ? r.vulnIds[0] : "x"))).toEqual(names.map((n) => `V-${n}`));
    });

    it("retries 503 with backoff and then succeeds", async () => {
        let calls = 0;
        const { client, sleep } = makeClient(async () =>
            ++calls === 1 ? new Response("busy", { status: 503 }) : json({ results: [{}] }),
        );
        expect(await client.queryPackages([pkg("a")])).toEqual([{ status: "ok", vulnIds: [] }]);
        expect(calls).toBe(2);
        expect(sleep).toHaveBeenCalledTimes(1);
    });

    it("honors Retry-After on 429", async () => {
        let calls = 0;
        const { client, sleep } = makeClient(async () =>
            ++calls === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "2" } }) : json({ results: [{}] }),
        );
        await client.queryPackages([pkg("a")]);
        expect(sleep).toHaveBeenCalledWith(2000);
    });

    it("reports failed - never ok-with-no-vulns - once retries are exhausted", async () => {
        const { client, fetchMock } = makeClient(async () => new Response("down", { status: 503 }));
        const out = await client.queryPackages([pkg("a"), pkg("b")]);
        expect(out.every((r) => r.status === "failed")).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + maxRetries
    });

    it("does not retry non-retryable client errors", async () => {
        const { client, fetchMock } = makeClient(async () => new Response("bad", { status: 400 }));
        const out = await client.queryPackages([pkg("a")]);
        expect(out[0]).toMatchObject({ status: "failed" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("treats timeouts and network errors as retryable then failed", async () => {
        const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
        const { client, fetchMock } = makeClient(async () => {
            throw timeout;
        });
        const out = await client.queryPackages([pkg("a")]);
        expect(out[0]).toMatchObject({ status: "failed", error: expect.stringContaining("timed out") });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("fails entries when the response shape or length is wrong", async () => {
        const { client } = makeClient(async () => json({ results: [] }));
        expect((await client.queryPackages([pkg("a")]))[0]).toMatchObject({ status: "failed" });
        const { client: c2 } = makeClient(async () => json({ nope: true }));
        expect((await c2.queryPackages([pkg("a")]))[0]).toMatchObject({ status: "failed" });
    });

    it("marks only unfinished entries failed when a later page fails", async () => {
        let calls = 0;
        const { client } = makeClient(async () =>
            ++calls === 1
                ? json({ results: [{ vulns: [{ id: "V1" }], next_page_token: "t" }, { vulns: [{ id: "V2" }] }] })
                : new Response("down", { status: 400 }),
        );
        const out = await client.queryPackages([pkg("a"), pkg("b")]);
        expect(out[0]).toMatchObject({ status: "failed" });
        expect(out[1]).toEqual({ status: "ok", vulnIds: ["V2"] });
    });
});

const record = {
    id: "GHSA-xxxx",
    modified: "2024-01-01T00:00:00Z",
    published: "2023-01-01T00:00:00Z",
    aliases: ["CVE-2023-0001"],
    summary: "Prototype pollution",
    severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
    database_specific: { severity: "high" },
    references: [{ type: "WEB", url: "https://example.test/advisory" }],
    affected: [
        {
            package: { ecosystem: "npm", name: "lodash" },
            ranges: [
                { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.12" }] },
                { type: "GIT", events: [{ introduced: "0" }, { fixed: "abcdef0123" }] },
            ],
        },
    ],
};

describe("OSV vulnerability records", () => {
    it("normalizes severity, references, aliases and fixed versions (ignoring GIT ranges)", () => {
        const n = normalizeVulnerability(osvVulnerabilitySchema.parse(record));
        expect(n.severityLabel).toBe("HIGH");
        expect(JSON.parse(n.severityJson!)[0].type).toBe("CVSS_V3");
        expect(n.aliases).toEqual(["CVE-2023-0001"]);
        expect(n.references).toEqual(["https://example.test/advisory"]);
        expect(n.affected).toHaveLength(1);
        expect(n.affected[0]!.fixedVersions).toEqual(["4.17.12"]);
        expect(n.affected[0]!.ranges).toHaveLength(1);
        expect(n.sourceUrl).toBe("https://osv.dev/vulnerability/GHSA-xxxx");
    });

    it("does not invent severity when upstream has none", () => {
        const n = normalizeVulnerability(osvVulnerabilitySchema.parse({ id: "X-1" }));
        expect(n.severityLabel).toBeNull();
        expect(n.severityJson).toBeNull();
        expect(n.affected).toEqual([]);
    });

    it("fetches by URL-encoded id and validates the record", async () => {
        const { client, fetchMock } = makeClient(async () => json(record));
        const v = await client.getVulnerability("GHSA-xxxx");
        expect(v.id).toBe("GHSA-xxxx");
        expect(fetchMock.mock.calls[0]![0]).toBe("https://api.osv.dev/v1/vulns/GHSA-xxxx");
        await client.getVulnerability("a/b c").catch(() => undefined);
        expect(fetchMock.mock.calls[1]![0]).toBe("https://api.osv.dev/v1/vulns/a%2Fb%20c");
    });

    it("maps 404 to not_found and bad shapes to invalid_response", async () => {
        const { client } = makeClient(async () => new Response("", { status: 404 }));
        await expect(client.getVulnerability("X")).rejects.toMatchObject({ kind: "not_found" });
        const { client: c2 } = makeClient(async () => json({ summary: "no id" }));
        await expect(c2.getVulnerability("X")).rejects.toBeInstanceOf(OsvError);
    });

    it("getVulnerabilities reports per-id success and failure", async () => {
        const { client } = makeClient(async (url) =>
            url.endsWith("/GOOD") ? json({ ...record, id: "GOOD" }) : new Response("", { status: 404 }),
        );
        const out = await client.getVulnerabilities(["GOOD", "BAD"]);
        expect(out.get("GOOD")?.status).toBe("ok");
        expect(out.get("BAD")?.status).toBe("failed");
    });
});