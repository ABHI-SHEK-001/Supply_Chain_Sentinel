import { describe, expect, it, vi } from "vitest";
import { scoreFinding, TriageService, type FindingRecord } from "../../src/modules/agents/triage.js";
import type { Decision } from "../../src/modules/memory/memory.types.js";

const rec = (over: Partial<FindingRecord> = {}): FindingRecord => ({
  vulnerabilityId: "GHSA-A", packageVersionId: "npm:a@1.0.0", name: "a", version: "1.0.0", severityLabel: "HIGH",
  direct: false, fixAvailable: false, advisoriesOnPackage: 1, ...over,
});

describe("scoreFinding", () => {
  it("scores severity plus exposure, and every point is in the evidence", () => {
    const f = scoreFinding(rec({ direct: true, fixAvailable: true, advisoriesOnPackage: 2 }));
    expect(f.score).toBe(30 + 10 + 5 + 5);
    expect(f.evidence.reduce((s, e) => s + e.points, 0)).toBe(f.score);
    expect(f.evidence.map((e) => e.factor)).toEqual(["severity", "direct_dependency", "fix_available", "multiple_advisories"]);
    expect(f.priority).toBe("P1");
  });

  it("maps scores to priorities at the documented thresholds", () => {
    expect(scoreFinding(rec({ severityLabel: "CRITICAL" })).priority).toBe("P1"); // 40
    expect(scoreFinding(rec({ severityLabel: "HIGH" })).priority).toBe("P2"); // 30
    expect(scoreFinding(rec({ severityLabel: "MODERATE", fixAvailable: true })).priority).toBe("P3"); // 25
    expect(scoreFinding(rec({ severityLabel: "LOW" })).score).toBe(10);
  });

  it("treats unknown severity as moderate and says so", () => {
    for (const label of [null, "WEIRD"]) {
      const f = scoreFinding(rec({ severityLabel: label }));
      expect(f.score).toBe(20);
      expect(f.evidence[0]!.detail).toContain("unknown");
    }
  });

  it("is case-insensitive and deterministic", () => {
    expect(scoreFinding(rec({ severityLabel: "high" })).score).toBe(30);
    expect(scoreFinding(rec())).toEqual(scoreFinding(rec()));
  });
});

const decision = (over: Partial<Decision> = {}): Decision => ({
  id: "dec_0000000000000001", repositoryId: "demo", type: "accepted_risk", vulnerabilityId: "GHSA-B", packageVersionId: "npm:b@1.0.0",
  planId: null, explanation: "unreachable", actor: "alice", evidence: null, status: "active", statusReason: null,
  createdAt: "", updatedAt: "", validUntil: "2027-01-01T00:00:00.000Z", severityAtDecision: "HIGH", fixAvailableAtDecision: false, supersededBy: null, ...over,
});

function setup(opts: { repo?: boolean; applying?: Decision[]; pending?: Decision[] } = {}) {
  const rows = [
    { vulnerabilityId: "GHSA-A", severityLabel: "HIGH", packageVersionId: "npm:a@1.0.0", name: "a", version: "1.0.0", direct: true, fixedVersions: ["1.0.1"] },
    { vulnerabilityId: "GHSA-B", severityLabel: "CRITICAL", packageVersionId: "npm:b@1.0.0", name: "b", version: "1.0.0", direct: false, fixedVersions: [] },
    { vulnerabilityId: "GHSA-C", severityLabel: null, packageVersionId: "npm:c@1.0.0", name: "c", version: "1.0.0", direct: false, fixedVersions: null },
    { vulnerabilityId: "GHSA-D", severityLabel: "LOW", packageVersionId: "npm:c@1.0.0", name: "c", version: "1.0.0", direct: false, fixedVersions: null },
  ];
  const graph = {
    query: vi.fn(),
    readQuery: vi.fn().mockImplementation(async (cypher: string) =>
      cypher.includes("AS vulnerabilityId") ? { data: rows } : { data: opts.repo === false ? [] : [{ id: "repo:demo" }] }),
  };
  const memory = {
    reevaluate: vi.fn().mockResolvedValue({
      applying: new Map((opts.applying ?? []).map((d) => [`${d.vulnerabilityId}|${d.packageVersionId}`, d])),
      transitions: [],
    }),
    search: vi.fn().mockResolvedValue(opts.pending ?? []),
  };
  return { graph, memory, service: new TriageService(graph, memory, () => new Date("2026-10-18T12:00:00.000Z")) };
}

describe("TriageService", () => {
  it("ranks findings by score, then id, with exposure derived from the graph", async () => {
    const { service, memory } = setup();
    const r = await service.triage("demo");
    expect(r.actionable.map((f) => [f.vulnerabilityId, f.score, f.priority])).toEqual([
      ["GHSA-A", 45, "P1"], // HIGH 30 + direct 10 + fix 5
      ["GHSA-B", 40, "P1"], // CRITICAL 40
      ["GHSA-C", 25, "P3"], // unknown severity 20 + multiple advisories 5
      ["GHSA-D", 15, "P3"], // LOW 10 + multiple advisories 5
    ]);
    expect(r.summary).toEqual({ totalFindings: 4, actionable: 4, suppressed: 0, byPriority: { P1: 2, P2: 0, P3: 2 } });
    // GHSA-C and GHSA-D share a package, so both get the multiple-advisories point
    expect(r.actionable.find((f) => f.vulnerabilityId === "GHSA-D")!.evidence.some((e) => e.factor === "multiple_advisories")).toBe(true);
    expect(memory.reevaluate).toHaveBeenCalledWith("demo", expect.arrayContaining([expect.objectContaining({ vulnerabilityId: "GHSA-A", fixAvailable: true })]));
  });

  it("moves findings covered by a valid decision to suppressed, with the decision shown", async () => {
    const { service } = setup({ applying: [decision()] });
    const r = await service.triage("demo");
    expect(r.suppressed).toEqual([expect.objectContaining({ vulnerabilityId: "GHSA-B", decisionId: "dec_0000000000000001", decisionType: "accepted_risk" })]);
    expect(r.actionable.map((f) => f.vulnerabilityId)).not.toContain("GHSA-B");
    expect(r.summary).toMatchObject({ actionable: 3, suppressed: 1 });
    expect(r.notes.join(" ")).toContain("suppressed");
  });

  it("keeps a finding actionable and annotated when its decision needs review", async () => {
    const { service } = setup({ pending: [decision({ status: "needs_review", statusReason: "a fix is now available" })] });
    const r = await service.triage("demo");
    const b = r.actionable.find((f) => f.vulnerabilityId === "GHSA-B")!;
    expect(b.reviewNote).toContain("dec_0000000000000001");
    expect(b.reviewNote).toContain("a fix is now available");
    expect(r.actionable.find((f) => f.vulnerabilityId === "GHSA-A")!.reviewNote).toBeNull();
  });

  it("404s for an unknown repository", async () => {
    await expect(setup({ repo: false }).service.triage("ghost")).rejects.toMatchObject({ statusCode: 404 });
  });
});
