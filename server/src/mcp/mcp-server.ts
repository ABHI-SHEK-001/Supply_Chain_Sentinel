import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentOrchestrator } from "../modules/agents/orchestrator.js";
import type { TriageService } from "../modules/agents/triage.js";
import { recordDecisionSchema, searchDecisionsSchema } from "../modules/memory/memory.routes.js";
import type { MemoryService } from "../modules/memory/memory.service.js";
import type { RemediationService } from "../modules/remediation/remediation.service.js";
import { repositoryIdSchema } from "../modules/repositories/repository.schemas.js";
import { AppError } from "../shared/errors/app-error.js";

export interface McpDeps {
  orchestrator: Pick<AgentOrchestrator, "start" | "getPipeline" | "listPipelines" | "getTask">;
  triage: Pick<TriageService, "triage">;
  remediation: Pick<RemediationService, "generatePlan" | "validatePlan" | "getPlan" | "listPlans">;
  memory: Pick<MemoryService, "recordDecision" | "search" | "revoke">;
}

const planId = z.string().regex(/^plan_[a-f0-9]{16}$/);
const pipelineId = z.string().regex(/^pipe_[a-f0-9]{16}$/);
const decisionId = z.string().regex(/^dec_[a-f0-9]{16}$/);
const vulnerabilityId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

/** Expected failures (not found, conflicts, validation) are shown to the model; unexpected ones are not leaked. */
function fail(err: unknown): ToolResult {
  const text = err instanceof AppError ? `${err.code}: ${err.message}` : "Internal error while running the tool.";
  return { content: [{ type: "text", text }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITES_GRAPH = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

/**
 * Tools are thin wrappers over the same services the REST API uses: no logic lives here.
 * Nothing exposed here edits a repository's files or runs an install.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "supplychain-sentinel", version: "1.0.0" });

  server.registerTool(
    "analyze_repository",
    {
      title: "Analyze repository",
      description:
        "Starts the background pipeline for a repository: scan for vulnerabilities, triage the findings, then plan remediation. " +
        "Returns immediately with a pipeline id; poll get_pipeline for progress. Only one analysis can run per repository at a time.",
      inputSchema: { repositoryId: repositoryIdSchema },
      annotations: { ...WRITES_GRAPH, title: "Analyze repository" },
    },
    ({ repositoryId }) => run(() => deps.orchestrator.start(repositoryId)),
  );

  server.registerTool(
    "get_pipeline",
    {
      title: "Get analysis pipeline",
      description: "Returns a pipeline's status and its three tasks (scanner, triager, remediator) with their inputs and outputs.",
      inputSchema: { pipelineId },
      annotations: { ...READ_ONLY, title: "Get analysis pipeline" },
    },
    ({ pipelineId: id }) => run(() => deps.orchestrator.getPipeline(id)),
  );

  server.registerTool(
    "list_pipelines",
    {
      title: "List analysis pipelines",
      description: "Lists recent analysis pipelines for a repository, newest first, with per-task status.",
      inputSchema: { repositoryId: repositoryIdSchema },
      annotations: { ...READ_ONLY, title: "List analysis pipelines" },
    },
    ({ repositoryId }) => run(() => deps.orchestrator.listPipelines(repositoryId)),
  );

  server.registerTool(
    "triage_findings",
    {
      title: "Triage findings",
      description:
        "Ranks a repository's vulnerability findings with a transparent score (severity plus exposure, every point listed as evidence) " +
        "and applies still-valid accepted-risk / false-positive decisions from memory. " +
        "Side effect: stored decisions whose conditions changed move to needs_review, expired or dormant.",
      inputSchema: { repositoryId: repositoryIdSchema },
      annotations: { ...WRITES_GRAPH, idempotentHint: true, title: "Triage findings" },
    },
    ({ repositoryId }) => run(() => deps.triage.triage(repositoryId)),
  );

  server.registerTool(
    "create_remediation_plan",
    {
      title: "Create remediation plan",
      description:
        "Computes the minimum set of package upgrades that clears the targeted vulnerabilities (all of them if none are given), " +
        "verified against OSV. The plan is a proposal: nothing is installed or changed.",
      inputSchema: { repositoryId: repositoryIdSchema, vulnerabilityIds: z.array(vulnerabilityId).min(1).max(200).optional() },
      annotations: { ...WRITES_GRAPH, idempotentHint: true, title: "Create remediation plan" },
    },
    ({ repositoryId, vulnerabilityIds }) => run(() => deps.remediation.generatePlan({ repositoryId, vulnerabilityIds })),
  );

  server.registerTool(
    "get_remediation_plan",
    {
      title: "Get remediation plan",
      description: "Returns a stored remediation plan, including its latest validation result if one exists.",
      inputSchema: { planId },
      annotations: { ...READ_ONLY, title: "Get remediation plan" },
    },
    ({ planId: id }) => run(() => deps.remediation.getPlan(id)),
  );

  server.registerTool(
    "list_remediation_plans",
    {
      title: "List remediation plans",
      description: "Lists stored remediation plans, optionally for one repository.",
      inputSchema: { repositoryId: repositoryIdSchema.optional() },
      annotations: { ...READ_ONLY, title: "List remediation plans" },
    },
    ({ repositoryId }) => run(() => deps.remediation.listPlans(repositoryId)),
  );

  server.registerTool(
    "validate_remediation_plan",
    {
      title: "Validate remediation plan",
      description:
        "Re-checks a plan against the current graph and OSV: confirms each claimed elimination, flags parent-range violations, " +
        "and reports stale if the lockfile changed. Saves the result on the plan.",
      inputSchema: { planId },
      annotations: { ...WRITES_GRAPH, idempotentHint: true, title: "Validate remediation plan" },
    },
    ({ planId: id }) => run(() => deps.remediation.validatePlan(id)),
  );

  server.registerTool(
    "search_decisions",
    {
      title: "Search decision memory",
      description:
        "Searches the repository's recorded decisions (accepted risks, false positives, fix outcomes, validated plans, notes). " +
        "Memory is scoped to one repository.",
      inputSchema: searchDecisionsSchema.shape,
      annotations: { ...READ_ONLY, title: "Search decision memory" },
    },
    (filters) => run(() => deps.memory.search(filters)),
  );

  server.registerTool(
    "record_decision",
    {
      title: "Record decision",
      description:
        "Records a decision in memory. accepted_risk and false_positive hide a finding from triage only while valid " +
        "(default 90 / 180 days, max 365) and are re-reviewed if severity rises, a fix appears, or the finding reappears. " +
        "The finding must currently exist. The actor is self-reported, not verified.",
      inputSchema: recordDecisionSchema.shape,
      annotations: { ...WRITES_GRAPH, title: "Record decision" },
    },
    (input) => run(() => deps.memory.recordDecision(input)),
  );

  server.registerTool(
    "revoke_decision",
    {
      title: "Revoke decision",
      description: "Withdraws a still-live decision so it stops applying.",
      inputSchema: { repositoryId: repositoryIdSchema, decisionId, reason: z.string().trim().min(1).max(500).optional() },
      annotations: { ...WRITES_GRAPH, title: "Revoke decision" },
    },
    ({ repositoryId, decisionId: id, reason }) => run(() => deps.memory.revoke(repositoryId, id, reason)),
  );

  return server;
}
