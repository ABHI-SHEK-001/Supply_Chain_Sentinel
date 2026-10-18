import { describe, expect, it } from "vitest";
import { evaluateDecision, severityRank } from "../../src/modules/memory/memory.rules.js";
import type { Decision } from "../../src/modules/memory/memory.types.js";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const base = (over: Partial<Decision> = {}): Pick<Decision, "type" | "status" | "validUntil" | "severityAtDecision" | "fixAvailableAtDecision"> => ({
  type: "accepted_risk",
  status: "active",
  validUntil: "2027-01-01T00:00:00.000Z",
  severityAtDecision: "HIGH",
  fixAvailableAtDecision: false,
  ...over,
});
const finding = (severityLabel: string | null = "HIGH", fixAvailable = false) => ({ severityLabel, fixAvailable });

describe("severityRank", () => {
  it("orders labels and treats unknown as 0", () => {
    expect(severityRank("critical")).toBeGreaterThan(severityRank("HIGH"));
    expect(severityRank("MEDIUM")).toBe(severityRank("MODERATE"));
    expect(severityRank(null)).toBe(0);
    expect(severityRank("WEIRD")).toBe(0);
  });
});

describe("evaluateDecision", () => {
  it("applies while nothing material has changed", () => {
    expect(evaluateDecision(base(), finding(), NOW)).toEqual({ applies: true, status: "active", reason: null });
  });

  it("expires once the validity window ends", () => {
    const r = evaluateDecision(base({ validUntil: "2026-10-01T00:00:00.000Z" }), finding(), NOW);
    expect(r).toMatchObject({ applies: false, status: "expired" });
  });

  it("goes to needs_review when severity rises, and not when it falls or stays", () => {
    expect(evaluateDecision(base(), finding("CRITICAL"), NOW)).toMatchObject({ applies: false, status: "needs_review" });
    expect(evaluateDecision(base(), finding("CRITICAL"), NOW).reason).toContain("HIGH to CRITICAL");
    expect(evaluateDecision(base(), finding("LOW"), NOW).applies).toBe(true);
    expect(evaluateDecision(base({ severityAtDecision: null }), finding("CRITICAL"), NOW).applies).toBe(true);
  });

  it("goes to needs_review when a fix becomes available, only if none existed at decision time", () => {
    expect(evaluateDecision(base(), finding("HIGH", true), NOW)).toMatchObject({ applies: false, status: "needs_review", reason: "a fix is now available" });
    expect(evaluateDecision(base({ fixAvailableAtDecision: true }), finding("HIGH", true), NOW).applies).toBe(true);
    expect(evaluateDecision(base({ fixAvailableAtDecision: null }), finding("HIGH", true), NOW).applies).toBe(true);
  });

  it("goes dormant when the finding disappears and needs_review when it comes back", () => {
    const gone = evaluateDecision(base(), null, NOW);
    expect(gone).toMatchObject({ applies: false, status: "dormant" });
    const back = evaluateDecision(base({ status: "dormant" }), finding(), NOW);
    expect(back).toMatchObject({ applies: false, status: "needs_review" });
  });

  it("keeps needs_review until someone records a new decision", () => {
    expect(evaluateDecision(base({ status: "needs_review" }), finding(), NOW)).toMatchObject({ applies: false, status: "needs_review" });
    expect(evaluateDecision(base({ status: "needs_review" }), null, NOW)).toMatchObject({ applies: false, status: "needs_review" });
  });

  it("never applies terminal or informational decisions", () => {
    for (const status of ["revoked", "superseded", "expired"] as const) {
      expect(evaluateDecision(base({ status }), finding(), NOW)).toMatchObject({ applies: false, status });
    }
    expect(evaluateDecision(base({ type: "note", validUntil: null }), finding(), NOW).applies).toBe(false);
    expect(evaluateDecision(base({ type: "plan_validated", validUntil: null }), finding(), NOW).applies).toBe(false);
  });

  it("applies a suppressing decision with no expiry", () => {
    expect(evaluateDecision(base({ validUntil: null }), finding(), NOW).applies).toBe(true);
  });
});
