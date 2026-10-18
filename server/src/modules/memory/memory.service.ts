import { createHash } from "node:crypto";
import { repositoryNodeId } from "../../infrastructure/graph/schema.js";
import { AppError, badRequest, notFound } from "../../shared/errors/app-error.js";
import type { GraphLike } from "../../shared/types/common.js";
import { evaluateDecision } from "./memory.rules.js";
import {
  SUPPRESSING_TYPES,
  type CurrentFindingState,
  type Decision,
  type DecisionSearch,
  type DecisionStatus,
  type DecisionTransition,
  type DecisionType,
  type RecordDecisionInput,
} from "./memory.types.js";

const DAY_MS = 86_400_000;
const MAX_VALIDITY_DAYS = 365;
const DEFAULT_VALIDITY_DAYS: Partial<Record<DecisionType, number>> = { accepted_risk: 90, false_positive: 180 };
const MAX_EVIDENCE_CHARS = 8192;

// Constant Cypher only; every value travels as a parameter.
const REPOSITORY_EXISTS = "MATCH (r:Repository {id: $id}) RETURN r.id AS id";

const FINDING_LOOKUP =
  "MATCH (:Repository {id: $repositoryNodeId})-[:CONTAINS]->(v:PackageVersion {id: $packageVersionId})" +
  "-[a:AFFECTED_BY]->(x:Vulnerability {id: $vulnerabilityId}) " +
  "RETURN x.severityLabel AS severityLabel, a.fixedVersions AS fixedVersions";

const UPSERT_DECISION =
  "MERGE (d:Decision {id: $id}) " +
  "SET d.repositoryId = $repositoryId, d.type = $type, d.vulnerabilityId = $vulnerabilityId, " +
  "d.packageVersionId = $packageVersionId, d.planId = $planId, d.explanation = $explanation, " +
  "d.actor = $actor, d.evidenceJson = $evidenceJson, d.status = $status, d.statusReason = $statusReason, " +
  "d.createdAt = coalesce(d.createdAt, $now), d.updatedAt = $now, d.validUntil = $validUntil, " +
  "d.severityAtDecision = $severityAtDecision, d.fixAvailableAtDecision = $fixAvailableAtDecision";

const LINK_REPOSITORY =
  "MATCH (r:Repository {id: $repositoryNodeId}) MATCH (d:Decision {id: $id}) MERGE (r)-[:RECORDED]->(d)";
const LINK_VULNERABILITY =
  "MATCH (d:Decision {id: $id}) MATCH (x:Vulnerability {id: $vulnerabilityId}) MERGE (d)-[:RELATED_TO]->(x)";
const LINK_PACKAGE =
  "MATCH (d:Decision {id: $id}) MATCH (v:PackageVersion {id: $packageVersionId}) MERGE (d)-[:RELATED_TO]->(v)";
const LINK_PLAN =
  "MATCH (d:Decision {id: $id}) MATCH (p:RemediationPlan {id: $planId}) MERGE (d)-[:RELATED_TO]->(p)";

const SUPERSEDE_OLDER =
  "MATCH (:Repository {id: $repositoryNodeId})-[:RECORDED]->(d:Decision) " +
  "WHERE d.vulnerabilityId = $vulnerabilityId AND d.packageVersionId = $packageVersionId " +
  "AND d.type IN $types AND d.status IN ['active', 'dormant', 'needs_review'] AND d.id <> $newId " +
  "SET d.status = 'superseded', d.statusReason = 'superseded by a newer decision', " +
  "d.supersededBy = $newId, d.updatedAt = $now";

const UPDATE_STATUS =
  "MATCH (d:Decision {id: $id}) SET d.status = $status, d.statusReason = $reason, d.updatedAt = $now";

const DECISION_COLUMNS =
  "RETURN d.id AS id, d.repositoryId AS repositoryId, d.type AS type, d.vulnerabilityId AS vulnerabilityId, " +
  "d.packageVersionId AS packageVersionId, d.planId AS planId, d.explanation AS explanation, d.actor AS actor, " +
  "d.evidenceJson AS evidenceJson, d.status AS status, d.statusReason AS statusReason, d.createdAt AS createdAt, " +
  "d.updatedAt AS updatedAt, d.validUntil AS validUntil, d.severityAtDecision AS severityAtDecision, " +
  "d.fixAvailableAtDecision AS fixAvailableAtDecision, d.supersededBy AS supersededBy";

const SEARCH_DECISIONS =
  "MATCH (:Repository {id: $repositoryNodeId})-[:RECORDED]->(d:Decision) " +
  "WHERE ($type IS NULL OR d.type = $type) AND ($vulnerabilityId IS NULL OR d.vulnerabilityId = $vulnerabilityId) " +
  "AND ($packageVersionId IS NULL OR d.packageVersionId = $packageVersionId) " +
  "AND ($status IS NULL OR d.status = $status) " +
  "AND ($q IS NULL OR toLower(d.explanation) CONTAINS toLower($q)) " +
  DECISION_COLUMNS +
  " ORDER BY d.createdAt DESC";

const LOAD_SUPPRESSING =
  "MATCH (:Repository {id: $repositoryNodeId})-[:RECORDED]->(d:Decision) " +
  "WHERE d.type IN ['accepted_risk', 'false_positive'] AND d.status IN ['active', 'dormant', 'needs_review'] " +
  DECISION_COLUMNS +
  " ORDER BY d.createdAt";

const LOAD_DECISION =
  "MATCH (:Repository {id: $repositoryNodeId})-[:RECORDED]->(d:Decision {id: $id}) " + DECISION_COLUMNS;

interface DecisionRow {
  id: string;
  repositoryId: string;
  type: DecisionType;
  vulnerabilityId: string | null;
  packageVersionId: string | null;
  planId: string | null;
  explanation: string;
  actor: string;
  evidenceJson: string | null;
  status: DecisionStatus;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
  validUntil: string | null;
  severityAtDecision: string | null;
  fixAvailableAtDecision: boolean | null;
  supersededBy: string | null;
}

function toDecision(r: DecisionRow): Decision {
  let evidence: Record<string, unknown> | null = null;
  if (r.evidenceJson) {
    try {
      const parsed: unknown = JSON.parse(r.evidenceJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) evidence = parsed as Record<string, unknown>;
    } catch {
      evidence = null;
    }
  }
  return {
    id: r.id,
    repositoryId: r.repositoryId,
    type: r.type,
    vulnerabilityId: r.vulnerabilityId ?? null,
    packageVersionId: r.packageVersionId ?? null,
    planId: r.planId ?? null,
    explanation: r.explanation,
    actor: r.actor,
    evidence,
    status: r.status,
    statusReason: r.statusReason ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    validUntil: r.validUntil ?? null,
    severityAtDecision: r.severityAtDecision ?? null,
    fixAvailableAtDecision: r.fixAvailableAtDecision ?? null,
    supersededBy: r.supersededBy ?? null,
  };
}

export const findingKey = (vulnerabilityId: string, packageVersionId: string): string =>
  `${vulnerabilityId}|${packageVersionId}`;

export class MemoryService {
  constructor(
    private readonly graph: GraphLike,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async recordDecision(input: RecordDecisionInput): Promise<Decision> {
    const repositoryNodeIdValue = repositoryNodeId(input.repositoryId);
    const exists = await this.graph.readQuery<{ id: string }>(REPOSITORY_EXISTS, { id: repositoryNodeIdValue });
    if (!exists.data?.[0]) throw notFound(`Repository "${input.repositoryId}" not found`);

    const suppressing = SUPPRESSING_TYPES.has(input.type);
    if (suppressing && (!input.vulnerabilityId || !input.packageVersionId)) {
      throw badRequest(`${input.type} decisions require both vulnerabilityId and packageVersionId`);
    }

    let severityAtDecision: string | null = null;
    let fixAvailableAtDecision: boolean | null = null;
    if (input.vulnerabilityId && input.packageVersionId) {
      const found = (
        await this.graph.readQuery<{ severityLabel: string | null; fixedVersions: string[] | null }>(FINDING_LOOKUP, {
          repositoryNodeId: repositoryNodeIdValue,
          packageVersionId: input.packageVersionId,
          vulnerabilityId: input.vulnerabilityId,
        })
      ).data?.[0];
      if (found) {
        severityAtDecision = found.severityLabel ?? null;
        fixAvailableAtDecision = (found.fixedVersions?.length ?? 0) > 0;
      } else if (suppressing) {
        throw new AppError(409, "FINDING_NOT_FOUND", "That vulnerability is not currently reported for that package version in this repository");
      }
    }

    const now = this.clock();
    const validUntil = this.resolveValidity(input, now);

    const evidenceJson = input.evidence ? JSON.stringify(input.evidence) : null;
    if (evidenceJson !== null && evidenceJson.length > MAX_EVIDENCE_CHARS) {
      throw badRequest(`evidence is too large (max ${MAX_EVIDENCE_CHARS} characters of JSON)`);
    }

    const createdAt = now.toISOString();
    const id = `dec_${createHash("sha256")
      .update(JSON.stringify([input.repositoryId, input.type, input.vulnerabilityId ?? null, input.packageVersionId ?? null, input.planId ?? null, input.actor, input.explanation, createdAt]))
      .digest("hex")
      .slice(0, 16)}`;

    await this.graph.query(UPSERT_DECISION, {
      id,
      repositoryId: input.repositoryId,
      type: input.type,
      vulnerabilityId: input.vulnerabilityId ?? null,
      packageVersionId: input.packageVersionId ?? null,
      planId: input.planId ?? null,
      explanation: input.explanation,
      actor: input.actor,
      evidenceJson,
      status: "active",
      statusReason: null,
      now: createdAt,
      validUntil,
      severityAtDecision,
      fixAvailableAtDecision,
    });
    await this.graph.query(LINK_REPOSITORY, { id, repositoryNodeId: repositoryNodeIdValue });
    if (input.vulnerabilityId) await this.graph.query(LINK_VULNERABILITY, { id, vulnerabilityId: input.vulnerabilityId });
    if (input.packageVersionId) await this.graph.query(LINK_PACKAGE, { id, packageVersionId: input.packageVersionId });
    if (input.planId) await this.graph.query(LINK_PLAN, { id, planId: input.planId });

    if (suppressing) {
      await this.graph.query(SUPERSEDE_OLDER, {
        repositoryNodeId: repositoryNodeIdValue,
        vulnerabilityId: input.vulnerabilityId as string,
        packageVersionId: input.packageVersionId as string,
        types: [...SUPPRESSING_TYPES],
        newId: id,
        now: createdAt,
      });
    }

    return {
      id,
      repositoryId: input.repositoryId,
      type: input.type,
      vulnerabilityId: input.vulnerabilityId ?? null,
      packageVersionId: input.packageVersionId ?? null,
      planId: input.planId ?? null,
      explanation: input.explanation,
      actor: input.actor,
      evidence: input.evidence ?? null,
      status: "active",
      statusReason: null,
      createdAt,
      updatedAt: createdAt,
      validUntil,
      severityAtDecision,
      fixAvailableAtDecision,
      supersededBy: null,
    };
  }

  private resolveValidity(input: RecordDecisionInput, now: Date): string | null {
    if (input.validUntil) {
      const t = Date.parse(input.validUntil);
      if (Number.isNaN(t) || t <= now.getTime()) throw badRequest("validUntil must be a future date");
      if (t > now.getTime() + MAX_VALIDITY_DAYS * DAY_MS) {
        throw badRequest(`validUntil may be at most ${MAX_VALIDITY_DAYS} days from now`);
      }
      return new Date(t).toISOString();
    }
    const days = DEFAULT_VALIDITY_DAYS[input.type];
    return days === undefined ? null : new Date(now.getTime() + days * DAY_MS).toISOString();
  }

  async search(filters: DecisionSearch): Promise<Decision[]> {
    const res = await this.graph.readQuery<DecisionRow>(SEARCH_DECISIONS, {
      repositoryNodeId: repositoryNodeId(filters.repositoryId),
      type: filters.type ?? null,
      vulnerabilityId: filters.vulnerabilityId ?? null,
      packageVersionId: filters.packageVersionId ?? null,
      status: filters.status ?? null,
      q: filters.q ?? null,
    });
    return (res.data ?? []).map(toDecision).slice(0, filters.limit ?? 50);
  }

  /** Withdraws a decision so it stops applying. Only decisions that are still live can be revoked. */
  async revoke(repositoryId: string, decisionId: string, reason?: string | undefined): Promise<Decision> {
    const row = (
      await this.graph.readQuery<DecisionRow>(LOAD_DECISION, { repositoryNodeId: repositoryNodeId(repositoryId), id: decisionId })
    ).data?.[0];
    if (!row) throw notFound(`Decision "${decisionId}" not found in repository "${repositoryId}"`);
    const decision = toDecision(row);
    if (decision.status === "revoked" || decision.status === "superseded" || decision.status === "expired") {
      throw new AppError(409, "DECISION_NOT_REVOCABLE", `Decision is already ${decision.status}`);
    }
    const now = this.clock().toISOString();
    const statusReason = reason ?? "revoked by user";
    await this.graph.query(UPDATE_STATUS, { id: decisionId, status: "revoked", reason: statusReason, now });
    return { ...decision, status: "revoked", statusReason, updatedAt: now };
  }

  /**
   * Re-evaluates this repository's suppressing decisions against the current findings,
   * persists status changes, and returns the decisions that still apply.
   */
  async reevaluate(
    repositoryId: string,
    findings: readonly CurrentFindingState[],
  ): Promise<{ applying: Map<string, Decision>; transitions: DecisionTransition[] }> {
    const nodeId = repositoryNodeId(repositoryId);
    const rows = (await this.graph.readQuery<DecisionRow>(LOAD_SUPPRESSING, { repositoryNodeId: nodeId })).data ?? [];
    const byKey = new Map(findings.map((f) => [findingKey(f.vulnerabilityId, f.packageVersionId), f]));
    const now = this.clock();
    const applying = new Map<string, Decision>();
    const transitions: DecisionTransition[] = [];

    for (const row of rows) {
      const decision = toDecision(row);
      if (!decision.vulnerabilityId || !decision.packageVersionId) continue;
      const key = findingKey(decision.vulnerabilityId, decision.packageVersionId);
      const current = byKey.get(key);
      const evaluation = evaluateDecision(
        decision,
        current ? { severityLabel: current.severityLabel, fixAvailable: current.fixAvailable } : null,
        now,
      );
      if (evaluation.status !== decision.status) {
        await this.graph.query(UPDATE_STATUS, {
          id: decision.id,
          status: evaluation.status,
          reason: evaluation.reason,
          now: now.toISOString(),
        });
        transitions.push({ decisionId: decision.id, from: decision.status, to: evaluation.status, reason: evaluation.reason });
        decision.status = evaluation.status;
        decision.statusReason = evaluation.reason;
      }
      if (evaluation.applies) applying.set(key, decision);
    }
    return { applying, transitions };
  }
}
