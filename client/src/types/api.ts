// ── API Envelope ──────────────────────────────────────────────
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Array<{ path: string; message: string }> | unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ── Health ────────────────────────────────────────────────────
export interface HealthData {
  status: 'ok';
  uptimeSeconds: number;
}

export type GraphStatus =
  | { status: 'not_configured' }
  | { status: 'up'; latencyMs: number }
  | { status: 'down'; error: string };

export interface ReadinessData {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  api: { status: 'up' };
  graph: GraphStatus;
}

// ── Repository ───────────────────────────────────────────────
export interface RepositorySummary {
  id: string;
  name: string;
  ecosystem: string | null;
  lockfileSha256: string | null;
  packageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface IngestionResult {
  repositorySlug: string;
  packagesCreated: number;
  edgesCreated: number;
  durationMs: number;
}

export interface RegisterRepositoryResult {
  repository: RepositorySummary;
  ingestion: IngestionResult;
}

// ── Agent / Pipeline / Task ──────────────────────────────────
export const AGENT_NAMES = ['scanner', 'triager', 'remediator'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'skipped'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface AgentTask {
  id: string;
  pipelineId: string;
  repositoryId: string;
  agent: AgentName;
  seq: number;
  status: TaskStatus;
  input: unknown;
  output: unknown;
  detail: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  handedOffTo: string | null;
}

export type PipelineStatus = 'running' | 'succeeded' | 'failed';

export interface PipelineSnapshot {
  id: string;
  repositoryId: string;
  status: PipelineStatus;
  createdAt: string;
  tasks: AgentTask[];
}

export interface PipelineSummary {
  id: string;
  repositoryId: string;
  status: PipelineStatus;
  createdAt: string;
  tasks: Array<{ id: string; agent: AgentName; status: TaskStatus; detail: string | null }>;
}

// ── Graph Analysis / Vulnerabilities ─────────────────────────
export type Truncation = 'path_limit' | 'depth_limit' | 'search_budget';

export interface PathView {
  length: number;
  devOnly: boolean;
  nodes: string[];
}

export interface FindingExposure {
  vulnerability: {
    id: string;
    summary: string | null;
    severityLabel: string | null;
    sourceUrl: string | null;
    detailsStatus: string | null;
  };
  affected: {
    packageVersionId: string;
    ecosystem: string;
    name: string;
    version: string;
    fixedVersions: string[] | null;
  };
  direct: boolean;
  reachableFromRoot: boolean;
  entryPoints: string[];
  shortestPathLength: number | null;
  paths: PathView[];
  pathsTruncated: boolean;
  truncation: Truncation | null;
}

export interface Coverage {
  packagesTotal: number;
  packagesChecked: number;
  packagesUnchecked: number;
  lastCheckedAt: string | null;
  complete: boolean;
}

export interface RepositoryExposure {
  repositoryId: string;
  analyzedAt: string;
  options: { maxDepth: number; maxPathsPerFinding: number };
  coverage: Coverage;
  summary: {
    findingCount: number;
    vulnerabilityCount: number;
    directlyAffectedCount: number;
    bySeverity: Record<string, number>;
  };
  findings: FindingExposure[];
}

export interface GraphView {
  repositoryId: string;
  totalNodes: number;
  totalEdges: number;
  truncated: boolean;
  nodes: Array<{
    id: string;
    ecosystem: string;
    name: string;
    version: string;
    direct: boolean;
    dev: boolean;
    optional: boolean;
    vulnerabilityIds: string[];
  }>;
  edges: Array<{ source: string; target: string; kind: string }>;
}

export interface VulnerabilitySummary {
  id: string;
  summary: string | null;
  severityLabel: string | null;
  sourceUrl: string | null;
  detailsStatus: string | null;
  aliases: string[];
  repositoryCount: number;
  packageVersionCount: number;
  repositories: string[];
}

export interface VulnerabilityDetail {
  vulnerability: {
    id: string;
    summary: string | null;
    details: string | null;
    aliases: string[];
    severityLabel: string | null;
    severity: unknown[] | null;
    published: string | null;
    modified: string | null;
    withdrawn: string | null;
    references: string[];
    sourceUrl: string | null;
    detailsStatus: string | null;
    lastCheckedAt: string | null;
  };
  repositories: Array<{ repositoryId: string; findings: FindingExposure[] }>;
}

// ── Remediation ──────────────────────────────────────────────
export interface PlanUpgrade {
  packageVersionId: string;
  ecosystem: string;
  name: string;
  fromVersion: string;
  toVersion: string;
  kind: 'direct' | 'transitive';
  majorBump: boolean;
  eliminates: Array<{ vulnerabilityId: string; severityLabel: string | null }>;
  residualVulnerabilityIds: string[];
  parentCompatibility: {
    status: 'compatible' | 'incompatible' | 'unknown';
    blockingParents: Array<{ parentId: string; range: string }>;
  };
  suggestedAction: string;
}

export type UncoveredReason =
  | 'vulnerability_details_unavailable'
  | 'no_fixed_version_reported'
  | 'no_verified_candidate'
  | 'candidate_lookup_failed';

export interface UncoveredTarget {
  packageVersionId: string;
  name: string;
  version: string;
  vulnerabilityIds: string[];
  reason: UncoveredReason;
  detail: string;
}

export interface PlanValidation {
  planId: string;
  validatedAt: string;
  status: 'valid' | 'invalid' | 'unverified' | 'stale';
  fullyResolvesTargets: boolean;
  eliminatedFindings: number;
  notEliminated: Array<{ packageVersionId: string; vulnerabilityId: string; reason: string }>;
  uncoveredTargetCount: number;
  parentRangeViolations: Array<{ packageVersionId: string; parentId: string; range: string; toVersion: string }>;
  targetVersionVulnerabilities: Array<{ packageVersionId: string; toVersion: string; vulnerabilityIds: string[] }>;
  lookupFailures: Array<{ packageVersionId: string; toVersion: string; error: string }>;
  notes: string[];
}

export interface RemediationPlan {
  id: string;
  repositoryId: string;
  generatedAt: string;
  lockfileSha256: string | null;
  status: 'proposed' | 'no_action_needed';
  objective: string;
  optimality: 'exact' | 'budget_exhausted';
  assumptions: string[];
  coverage: { complete: boolean; packagesUnchecked: number };
  targeted: {
    findingCount: number;
    vulnerabilityCount: number;
    vulnerabilityIds: string[];
    findings: Array<{ vulnerabilityId: string; packageVersionId: string }>;
  };
  upgrades: PlanUpgrade[];
  uncovered: UncoveredTarget[];
  validation: PlanValidation | null;
}

export interface PlanSummary {
  id: string;
  repositoryId: string;
  createdAt: string | null;
  updatedAt: string | null;
  status: string | null;
  upgradeCount: number;
  uncoveredCount: number;
  validationStatus: string | null;
}

// ── Memory / Decisions ───────────────────────────────────────
export const DECISION_TYPES = [
  'accepted_risk',
  'false_positive',
  'fix_succeeded',
  'fix_failed',
  'plan_validated',
  'note',
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const DECISION_STATUSES = [
  'active',
  'dormant',
  'needs_review',
  'expired',
  'superseded',
  'revoked',
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export interface Decision {
  id: string;
  repositoryId: string;
  type: DecisionType;
  vulnerabilityId: string | null;
  packageVersionId: string | null;
  planId: string | null;
  explanation: string;
  actor: string;
  evidence: Record<string, unknown> | null;
  status: DecisionStatus;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
  validUntil: string | null;
  severityAtDecision: string | null;
  fixAvailableAtDecision: boolean | null;
  supersededBy: string | null;
}

export interface RecordDecisionInput {
  repositoryId: string;
  type: DecisionType;
  vulnerabilityId?: string;
  packageVersionId?: string;
  planId?: string;
  explanation: string;
  actor: string;
  evidence?: Record<string, unknown>;
  validUntil?: string;
}

export interface DecisionSearch {
  repositoryId: string;
  type?: DecisionType;
  vulnerabilityId?: string;
  packageVersionId?: string;
  status?: DecisionStatus;
  q?: string;
  limit?: number;
}
