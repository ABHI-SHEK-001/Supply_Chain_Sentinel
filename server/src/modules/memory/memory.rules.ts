import { SUPPRESSING_TYPES, type Decision, type DecisionStatus } from "./memory.types.js";

const SEVERITY_RANK: Record<string, number> = { LOW: 1, MODERATE: 2, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
export const severityRank = (label: string | null): number => (label ? (SEVERITY_RANK[label.toUpperCase()] ?? 0) : 0);

export interface CurrentFinding {
  severityLabel: string | null;
  fixAvailable: boolean;
}

export interface Evaluation {
  /** True only if the decision should still hide the finding right now. */
  applies: boolean;
  status: DecisionStatus;
  reason: string | null;
}

type Evaluable = Pick<Decision, "type" | "status" | "validUntil" | "severityAtDecision" | "fixAvailableAtDecision">;

/**
 * Re-evaluation rules for a decision against the finding it concerns (null = finding absent).
 * A suppressing decision never applies forever: it lapses on expiry and goes to review when
 * the severity rises, a fix becomes available, or the finding reappears after being absent.
 */
export function evaluateDecision(d: Evaluable, finding: CurrentFinding | null, now: Date): Evaluation {
  if (d.status === "revoked" || d.status === "superseded" || d.status === "expired") {
    return { applies: false, status: d.status, reason: `decision is ${d.status}` };
  }
  if (!SUPPRESSING_TYPES.has(d.type)) {
    return { applies: false, status: d.status, reason: "informational decision; it does not suppress findings" };
  }
  if (d.validUntil !== null && now.getTime() > Date.parse(d.validUntil)) {
    return { applies: false, status: "expired", reason: "validity period ended" };
  }
  if (finding === null) {
    return {
      applies: false,
      status: d.status === "needs_review" ? "needs_review" : "dormant",
      reason: "finding is not present in the repository",
    };
  }
  if (d.status === "dormant") {
    return { applies: false, status: "needs_review", reason: "finding reappeared after being absent; re-confirm the decision" };
  }
  if (d.status === "needs_review") {
    return { applies: false, status: "needs_review", reason: "awaiting re-confirmation" };
  }
  if (d.severityAtDecision !== null && severityRank(finding.severityLabel) > severityRank(d.severityAtDecision)) {
    return {
      applies: false,
      status: "needs_review",
      reason: `severity increased from ${d.severityAtDecision} to ${finding.severityLabel ?? "unknown"}`,
    };
  }
  if (d.fixAvailableAtDecision === false && finding.fixAvailable) {
    return { applies: false, status: "needs_review", reason: "a fix is now available" };
  }
  return { applies: true, status: "active", reason: null };
}
