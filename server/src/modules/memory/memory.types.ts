export const DECISION_TYPES = [
  "accepted_risk",
  "false_positive",
  "fix_succeeded",
  "fix_failed",
  "plan_validated",
  "note",
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

/** Only these decisions can hide a finding from triage, and only while they still apply. */
export const SUPPRESSING_TYPES: ReadonlySet<DecisionType> = new Set<DecisionType>(["accepted_risk", "false_positive"]);

export const DECISION_STATUSES = ["active", "dormant", "needs_review", "expired", "superseded", "revoked"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export interface Decision {
  id: string;
  repositoryId: string;
  type: DecisionType;
  vulnerabilityId: string | null;
  packageVersionId: string | null;
  planId: string | null;
  explanation: string;
  /** Self-reported; the API is unauthenticated, so this is not a verified identity. */
  actor: string;
  evidence: Record<string, unknown> | null;
  status: DecisionStatus;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
  validUntil: string | null;
  /** Snapshots taken from the graph when the decision was recorded; used for re-evaluation. */
  severityAtDecision: string | null;
  fixAvailableAtDecision: boolean | null;
  supersededBy: string | null;
}

export interface RecordDecisionInput {
  repositoryId: string;
  type: DecisionType;
  vulnerabilityId?: string | undefined;
  packageVersionId?: string | undefined;
  planId?: string | undefined;
  explanation: string;
  actor: string;
  evidence?: Record<string, unknown> | undefined;
  validUntil?: string | undefined;
}

export interface DecisionSearch {
  repositoryId: string;
  type?: DecisionType | undefined;
  vulnerabilityId?: string | undefined;
  packageVersionId?: string | undefined;
  status?: DecisionStatus | undefined;
  q?: string | undefined;
  limit?: number | undefined;
}

export interface CurrentFindingState {
  vulnerabilityId: string;
  packageVersionId: string;
  severityLabel: string | null;
  fixAvailable: boolean;
}

export interface DecisionTransition {
  decisionId: string;
  from: DecisionStatus;
  to: DecisionStatus;
  reason: string | null;
}
