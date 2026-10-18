import type { MemoryService } from "../memory/memory.service.js";
import type { RemediationService } from "../remediation/remediation.service.js";
import type { TriageReport, TriageService } from "./triage.js";

// ---- Handoff contracts: each agent's output is stored as the next task's input ----

export interface ScannerInput {
  repositoryId: string;
}
export interface ScannerOutput {
  repositoryId: string;
  /** Whatever the vulnerability scan reported, stored as plain JSON. */
  scan: unknown;
}

export type TriagerInput = ScannerOutput;
export interface TriagerOutput {
  repositoryId: string;
  report: TriageReport;
}

export interface RemediatorInput {
  repositoryId: string;
  vulnerabilityIds: string[];
  actionableFindings: number;
  suppressedFindings: number;
}
export interface RemediatorOutput {
  repositoryId: string;
  planId: string;
  planStatus: string;
  upgradeCount: number;
  uncoveredCount: number;
  optimality: string;
  validationStatus: string | null;
  fullyResolvesTargets: boolean;
  decisionId: string | null;
  notes: string[];
}

export interface ScannerPort {
  run(input: ScannerInput): Promise<ScannerOutput>;
}
export interface TriagerPort {
  run(input: TriagerInput): Promise<TriagerOutput>;
}
export interface RemediatorPort {
  run(input: RemediatorInput): Promise<RemediatorOutput>;
}

const MAX_SCAN_JSON = 16_000;

/** Makes an arbitrary service result safe to persist as JSON, without ever throwing. */
export function toJsonSafe(value: unknown): unknown {
  try {
    const json = JSON.stringify(value ?? null);
    if (json === undefined) return null;
    if (json.length > MAX_SCAN_JSON) return { truncated: true, originalLength: json.length };
    return JSON.parse(json) as unknown;
  } catch {
    return { unserializable: true };
  }
}

/** Refreshes vulnerability data for the repository by running the existing OSV scan. */
export class ScannerAgent implements ScannerPort {
  constructor(private readonly scanner: { scanRepository(repositoryId: string): Promise<unknown> }) {}
  async run(input: ScannerInput): Promise<ScannerOutput> {
    const result = await this.scanner.scanRepository(input.repositoryId);
    return { repositoryId: input.repositoryId, scan: toJsonSafe(result) };
  }
}

/** Ranks findings deterministically and applies still-valid risk decisions from memory. */
export class TriageAgent implements TriagerPort {
  constructor(private readonly triage: Pick<TriageService, "triage">) {}
  async run(input: TriagerInput): Promise<TriagerOutput> {
    return { repositoryId: input.repositoryId, report: await this.triage.triage(input.repositoryId) };
  }
}

/** Plans (and validates) the minimum set of upgrades for the actionable findings. */
export class RemediationAgent implements RemediatorPort {
  constructor(
    private readonly remediation: Pick<RemediationService, "generatePlan" | "validatePlan">,
    private readonly memory: Pick<MemoryService, "recordDecision">,
  ) {}

  async run(input: RemediatorInput): Promise<RemediatorOutput> {
    const plan = await this.remediation.generatePlan({
      repositoryId: input.repositoryId,
      vulnerabilityIds: input.vulnerabilityIds,
    });
    const validation = plan.status === "no_action_needed" ? null : await this.remediation.validatePlan(plan.id);

    let decisionId: string | null = null;
    if (validation?.status === "valid" && plan.upgrades.length > 0) {
      const decision = await this.memory.recordDecision({
        repositoryId: input.repositoryId,
        type: "plan_validated",
        planId: plan.id,
        explanation: `Plan ${plan.id} validated: ${plan.upgrades.length} upgrade(s) eliminate ${validation.eliminatedFindings} finding(s).`,
        actor: "agent:remediator",
        evidence: {
          upgrades: plan.upgrades.map((u) => `${u.name} ${u.fromVersion} -> ${u.toVersion}`),
          fullyResolvesTargets: validation.fullyResolvesTargets,
        },
      });
      decisionId = decision.id;
    }

    const notes = ["No repository files were changed; the plan is a proposal."];
    if (input.suppressedFindings > 0) {
      notes.push("Plans target advisories by id, so an advisory that is suppressed on one package but actionable on another is still planned for both.");
    }
    if (plan.uncovered.length > 0) notes.push(`${plan.uncovered.length} package(s) have no verified upgrade and remain exposed.`);

    return {
      repositoryId: input.repositoryId,
      planId: plan.id,
      planStatus: plan.status,
      upgradeCount: plan.upgrades.length,
      uncoveredCount: plan.uncovered.length,
      optimality: plan.optimality,
      validationStatus: validation?.status ?? null,
      fullyResolvesTargets: validation?.fullyResolvesTargets ?? false,
      decisionId,
      notes,
    };
  }
}

/** The handoff from triager to remediator: the distinct advisories that still need action. */
export function toRemediatorInput(out: TriagerOutput): RemediatorInput {
  const ids = [...new Set(out.report.actionable.map((f) => f.vulnerabilityId))].sort();
  return {
    repositoryId: out.repositoryId,
    vulnerabilityIds: ids,
    actionableFindings: out.report.actionable.length,
    suppressedFindings: out.report.suppressed.length,
  };
}
