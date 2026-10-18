import { repositoryNodeId } from "../../infrastructure/graph/schema.js";
import { notFound } from "../../shared/errors/app-error.js";
import type { GraphLike } from "../../shared/types/common.js";
import { findingKey, type MemoryService } from "../memory/memory.service.js";
import type { DecisionTransition } from "../memory/memory.types.js";

export interface FindingRecord {
  vulnerabilityId: string;
  packageVersionId: string;
  name: string;
  version: string;
  severityLabel: string | null;
  direct: boolean;
  fixAvailable: boolean;
  /** How many advisories (in this repository's data) affect the same package version. */
  advisoriesOnPackage: number;
}

export interface EvidenceItem {
  factor: string;
  points: number;
  detail: string;
}

export type Priority = "P1" | "P2" | "P3";

export interface ScoredFinding extends FindingRecord {
  score: number;
  priority: Priority;
  /** Every point in `score` appears here; the score is the sum of `evidence[].points`. */
  evidence: EvidenceItem[];
  /** Set when an earlier risk decision for this finding is awaiting review. */
  reviewNote: string | null;
}

export interface SuppressedFinding {
  vulnerabilityId: string;
  packageVersionId: string;
  name: string;
  version: string;
  decisionId: string;
  decisionType: string;
  explanation: string;
  validUntil: string | null;
}

export interface TriageReport {
  repositoryId: string;
  generatedAt: string;
  summary: { totalFindings: number; actionable: number; suppressed: number; byPriority: Record<Priority, number> };
  actionable: ScoredFinding[];
  suppressed: SuppressedFinding[];
  memoryTransitions: DecisionTransition[];
  notes: string[];
}

export const SEVERITY_POINTS: Readonly<Record<string, number>> = { CRITICAL: 40, HIGH: 30, MODERATE: 20, MEDIUM: 20, LOW: 10 };
const UNKNOWN_SEVERITY_POINTS = 20;
export const P1_THRESHOLD = 40;
export const P2_THRESHOLD = 30;

/** Deterministic scoring. Same input, same score, and every point is explained in `evidence`. */
export function scoreFinding(f: FindingRecord, reviewNote: string | null = null): ScoredFinding {
  const evidence: EvidenceItem[] = [];
  const label = f.severityLabel?.toUpperCase() ?? null;
  const known = label !== null ? SEVERITY_POINTS[label] : undefined;
  if (known !== undefined) {
    evidence.push({ factor: "severity", points: known, detail: `OSV severity ${label}` });
  } else {
    evidence.push({ factor: "severity", points: UNKNOWN_SEVERITY_POINTS, detail: "severity unknown; treated as MODERATE so it is not buried" });
  }
  if (f.direct) {
    evidence.push({ factor: "direct_dependency", points: 10, detail: "declared directly by the repository, so it is on the code's own import path" });
  }
  if (f.fixAvailable) {
    evidence.push({ factor: "fix_available", points: 5, detail: "OSV reports a fixed version, so action is possible" });
  }
  if (f.advisoriesOnPackage >= 2) {
    evidence.push({ factor: "multiple_advisories", points: 5, detail: `${f.advisoriesOnPackage} advisories affect this package version` });
  }
  const score = evidence.reduce((sum, e) => sum + e.points, 0);
  const priority: Priority = score >= P1_THRESHOLD ? "P1" : score >= P2_THRESHOLD ? "P2" : "P3";
  return { ...f, score, priority, evidence, reviewNote };
}

const byScore = (a: ScoredFinding, b: ScoredFinding): number =>
  b.score - a.score || a.vulnerabilityId.localeCompare(b.vulnerabilityId) || a.packageVersionId.localeCompare(b.packageVersionId);

const LOAD_FINDINGS =
  "MATCH (:Repository {id: $id})-[c:CONTAINS]->(v:PackageVersion)-[a:AFFECTED_BY]->(x:Vulnerability) " +
  "RETURN x.id AS vulnerabilityId, x.severityLabel AS severityLabel, v.id AS packageVersionId, " +
  "v.name AS name, v.version AS version, c.direct AS direct, a.fixedVersions AS fixedVersions " +
  "ORDER BY x.id, v.id";

const REPOSITORY_EXISTS = "MATCH (r:Repository {id: $id}) RETURN r.id AS id";

interface FindingRow {
  vulnerabilityId: string;
  severityLabel: string | null;
  packageVersionId: string;
  name: string;
  version: string;
  direct: boolean | null;
  fixedVersions: string[] | null;
}

export class TriageService {
  constructor(
    private readonly graph: GraphLike,
    private readonly memory: Pick<MemoryService, "reevaluate" | "search">,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Ranks the repository's findings. Side effect: re-evaluates stored risk decisions, so a decision whose
   * conditions changed moves to needs_review (or expired/dormant) as part of triage.
   */
  async triage(repositoryId: string): Promise<TriageReport> {
    const id = repositoryNodeId(repositoryId);
    const repo = (await this.graph.readQuery<{ id: string }>(REPOSITORY_EXISTS, { id })).data?.[0];
    if (!repo) throw notFound(`Repository "${repositoryId}" not found`);

    const rows = (await this.graph.readQuery<FindingRow>(LOAD_FINDINGS, { id })).data ?? [];
    const perPackage = new Map<string, number>();
    for (const r of rows) perPackage.set(r.packageVersionId, (perPackage.get(r.packageVersionId) ?? 0) + 1);
    const records: FindingRecord[] = rows.map((r) => ({
      vulnerabilityId: r.vulnerabilityId,
      packageVersionId: r.packageVersionId,
      name: r.name,
      version: r.version,
      severityLabel: r.severityLabel ?? null,
      direct: r.direct === true,
      fixAvailable: (r.fixedVersions?.length ?? 0) > 0,
      advisoriesOnPackage: perPackage.get(r.packageVersionId) ?? 1,
    }));

    const { applying, transitions } = await this.memory.reevaluate(
      repositoryId,
      records.map((r) => ({
        vulnerabilityId: r.vulnerabilityId,
        packageVersionId: r.packageVersionId,
        severityLabel: r.severityLabel,
        fixAvailable: r.fixAvailable,
      })),
    );
    const pending = await this.memory.search({ repositoryId, status: "needs_review", limit: 200 });
    const reviewByKey = new Map<string, string>();
    for (const d of pending) {
      if (d.vulnerabilityId && d.packageVersionId) {
        reviewByKey.set(
          findingKey(d.vulnerabilityId, d.packageVersionId),
          `Earlier ${d.type} decision ${d.id} needs review: ${d.statusReason ?? "conditions changed"}`,
        );
      }
    }

    const actionable: ScoredFinding[] = [];
    const suppressed: SuppressedFinding[] = [];
    for (const r of records) {
      const key = findingKey(r.vulnerabilityId, r.packageVersionId);
      const decision = applying.get(key);
      if (decision) {
        suppressed.push({
          vulnerabilityId: r.vulnerabilityId,
          packageVersionId: r.packageVersionId,
          name: r.name,
          version: r.version,
          decisionId: decision.id,
          decisionType: decision.type,
          explanation: decision.explanation,
          validUntil: decision.validUntil,
        });
      } else {
        actionable.push(scoreFinding(r, reviewByKey.get(key) ?? null));
      }
    }
    actionable.sort(byScore);

    const byPriority: Record<Priority, number> = { P1: 0, P2: 0, P3: 0 };
    for (const f of actionable) byPriority[f.priority]++;

    const notes = [
      "Scores are a transparent heuristic (severity + exposure), not a measure of exploitability; reachability is not analyzed.",
    ];
    if (suppressed.length > 0) notes.push(`${suppressed.length} finding(s) are hidden by active risk decisions that remain valid; they are listed under "suppressed".`);
    if (transitions.length > 0) notes.push(`${transitions.length} stored decision(s) changed state during this triage.`);

    return {
      repositoryId,
      generatedAt: this.clock().toISOString(),
      summary: { totalFindings: records.length, actionable: actionable.length, suppressed: suppressed.length, byPriority },
      actionable,
      suppressed,
      memoryTransitions: transitions,
      notes,
    };
  }
}
