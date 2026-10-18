import { describe, expect, it, vi } from "vitest";
import { MemoryService } from "../../src/modules/memory/memory.service.js";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const DAY = 86_400_000;
const PV = "npm:lodash@4.17.15";

interface Row {
  id: string; repositoryId: string; type: string; vulnerabilityId: string | null; packageVersionId: string | null;
  planId: string | null; explanation: string; actor: string; evidenceJson: string | null; status: string;
  statusReason: string | null; createdAt: string; updatedAt: string; validUntil: string | null;
  severityAtDecision: string | null; fixAvailableAtDecision: boolean | null; supersededBy: string | null;
}
const row = (over: Partial<Row> = {}): Row => ({
  id: "dec_0000000000000001", repositoryId: "demo", type: "accepted_risk", vulnerabilityId: "GHSA-A", packageVersionId: PV,
  planId: null, explanation: "ok", actor: "alice", evidenceJson: null, status: "active", statusReason: null,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z",
  severityAtDecision: "HIGH", fixAvailableAtDecision: false, supersededBy: null, ...over,
});

function setup(opts: { repo?: boolean; finding?: { severityLabel: string | null; fixedVersions: string[] | null } | null; rows?: Row[] } = {}) {
  const rows = opts.rows ?? [];
  const finding = opts.finding === undefined ? { severityLabel: "HIGH", fixedVersions: [] as string[] } : opts.finding;
  const graph = {
    query: vi.fn().mockResolvedValue({ data: [] }),
    readQuery: vi.fn().mockImplementation(async (cypher: string) => {
      if (cypher.includes("RETURN r.id AS id")) return { data: opts.repo === false ? [] : [{ id: "repo:demo" }] };
      if (cypher.includes("AS fixedVersions")) return { data: finding ? [finding] : [] };
      if (cypher.includes("Decision {id: $id}")) return { data: rows.slice(0, 1) };
      return { data: rows };
    }),
  };
  return { graph, service: new MemoryService(graph, () => NOW) };
}
const writes = (g: ReturnType<typeof setup>["graph"]) => g.query.mock.calls as Array<[string, Record<string, unknown>]>;
const base = { repositoryId: "demo", type: "accepted_risk" as const, vulnerabilityId: "GHSA-A", packageVersionId: PV, explanation: "not reachable", actor: "alice" };

describe("MemoryService.recordDecision", () => {
  it("snapshots severity and fix availability, applies the default 90-day window and links the graph", async () => {
    const { service, graph } = setup({ finding: { severityLabel: "HIGH", fixedVersions: ["4.17.21"] } });
    const d = await service.recordDecision(base);
    expect(d).toMatchObject({ status: "active", severityAtDecision: "HIGH", fixAvailableAtDecision: true, type: "accepted_risk" });
    expect(d.id).toMatch(/^dec_[a-f0-9]{16}$/);
    expect(Date.parse(d.validUntil as string)).toBe(NOW.getTime() + 90 * DAY);
    const cyphers = writes(graph).map(([c]) => c);
    expect(cyphers.some((c) => c.includes("MERGE (r)-[:RECORDED]->(d)"))).toBe(true);
    expect(cyphers.some((c) => c.includes("(d)-[:RELATED_TO]->(x)"))).toBe(true);
    expect(cyphers.some((c) => c.includes("(d)-[:RELATED_TO]->(v)"))).toBe(true);
    expect(cyphers.some((c) => c.includes("SET d.status = 'superseded'"))).toBe(true);
  });

  it("uses 180 days for false positives and honors an explicit validUntil", async () => {
    const { service } = setup();
    const fp = await service.recordDecision({ ...base, type: "false_positive" });
    expect(Date.parse(fp.validUntil as string)).toBe(NOW.getTime() + 180 * DAY);
    const until = new Date(NOW.getTime() + 30 * DAY).toISOString();
    expect((await service.recordDecision({ ...base, validUntil: until })).validUntil).toBe(until);
  });

  it("rejects validUntil in the past or beyond 365 days", async () => {
    const { service } = setup();
    await expect(service.recordDecision({ ...base, validUntil: new Date(NOW.getTime() - DAY).toISOString() })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.recordDecision({ ...base, validUntil: new Date(NOW.getTime() + 366 * DAY).toISOString() })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("requires the finding to exist for suppressing decisions", async () => {
    const { service, graph } = setup({ finding: null });
    await expect(service.recordDecision(base)).rejects.toMatchObject({ statusCode: 409, code: "FINDING_NOT_FOUND" });
    expect(writes(graph)).toHaveLength(0);
  });

  it("requires both ids for suppressing decisions", async () => {
    const { service } = setup();
    await expect(service.recordDecision({ ...base, packageVersionId: undefined })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.recordDecision({ ...base, vulnerabilityId: undefined })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("records informational decisions without a finding, an expiry, or superseding anything", async () => {
    const { service, graph } = setup();
    const note = await service.recordDecision({ repositoryId: "demo", type: "note", explanation: "rotated keys", actor: "bob" });
    expect(note).toMatchObject({ status: "active", validUntil: null, vulnerabilityId: null });
    expect(writes(graph).some(([c]) => c.includes("superseded"))).toBe(false);
  });

  it("returns 404 for an unknown repository and 400 for oversized evidence", async () => {
    await expect(setup({ repo: false }).service.recordDecision(base)).rejects.toMatchObject({ statusCode: 404 });
    await expect(setup().service.recordDecision({ ...base, evidence: { blob: "x".repeat(9000) } })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("uses parameterised Cypher only and never passes undefined", async () => {
    const { service, graph } = setup();
    await service.recordDecision({ ...base, explanation: "x'); MATCH (n) DETACH DELETE n //" });
    for (const [cypher, params] of writes(graph)) {
      expect(cypher).not.toContain("DETACH DELETE");
      expect(cypher).not.toContain("GHSA-A");
      expect(Object.values(params).includes(undefined)).toBe(false);
    }
  });
});

describe("MemoryService.reevaluate", () => {
  const same = { vulnerabilityId: "GHSA-A", packageVersionId: PV, severityLabel: "HIGH", fixAvailable: false };

  it("returns applying decisions and writes nothing when nothing changed", async () => {
    const { service, graph } = setup({ rows: [row()] });
    const out = await service.reevaluate("demo", [same]);
    expect([...out.applying.keys()]).toEqual([`GHSA-A|${PV}`]);
    expect(out.transitions).toEqual([]);
    expect(writes(graph)).toHaveLength(0);
  });

  it("persists transitions: severity rise, fix available, absence, expiry", async () => {
    const { service, graph } = setup({
      rows: [
        row({ id: "dec_0000000000000001" }),
        row({ id: "dec_0000000000000002", vulnerabilityId: "GHSA-B" }),
        row({ id: "dec_0000000000000003", vulnerabilityId: "GHSA-C" }),
        row({ id: "dec_0000000000000004", vulnerabilityId: "GHSA-D", validUntil: "2026-01-01T00:00:00.000Z" }),
      ],
    });
    const out = await service.reevaluate("demo", [
      { ...same, severityLabel: "CRITICAL" },
      { vulnerabilityId: "GHSA-B", packageVersionId: PV, severityLabel: "HIGH", fixAvailable: true },
      { vulnerabilityId: "GHSA-D", packageVersionId: PV, severityLabel: "HIGH", fixAvailable: false },
    ]);
    expect(out.applying.size).toBe(0);
    expect(out.transitions.map((t) => [t.decisionId.slice(-1), t.to])).toEqual([["1", "needs_review"], ["2", "needs_review"], ["3", "dormant"], ["4", "expired"]]);
    expect(writes(graph)).toHaveLength(4);
    expect(writes(graph)[0]![1]).toMatchObject({ id: "dec_0000000000000001", status: "needs_review" });
  });
});

describe("MemoryService.revoke", () => {
  it("revokes a live decision", async () => {
    const { service, graph } = setup({ rows: [row()] });
    const d = await service.revoke("demo", "dec_0000000000000001", "no longer true");
    expect(d).toMatchObject({ status: "revoked", statusReason: "no longer true" });
    expect(writes(graph)[0]![1]).toMatchObject({ status: "revoked", id: "dec_0000000000000001" });
  });
  it("404s for an unknown decision and 409s for one already finished", async () => {
    await expect(setup({ rows: [] }).service.revoke("demo", "dec_0000000000000009")).rejects.toMatchObject({ statusCode: 404 });
    await expect(setup({ rows: [row({ status: "revoked" })] }).service.revoke("demo", "dec_0000000000000001")).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("MemoryService.search", () => {
  it("passes null for missing filters and respects limit", async () => {
    const { service, graph } = setup({ rows: [row(), row({ id: "dec_0000000000000002" })] });
    const out = await service.search({ repositoryId: "demo", limit: 1 });
    expect(out).toHaveLength(1);
    expect(graph.readQuery.mock.calls[0]![1]).toMatchObject({ type: null, status: null, q: null, repositoryNodeId: "repo:demo" });
  });
});
