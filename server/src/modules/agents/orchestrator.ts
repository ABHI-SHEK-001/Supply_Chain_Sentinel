import { createHash, randomBytes } from "node:crypto";
import { AppError, notFound } from "../../shared/errors/app-error.js";
import { toRemediatorInput, type RemediatorPort, type ScannerPort, type TriagerPort } from "./agents.js";
import { pipelineStatus, transition } from "./task.state.js";
import type { TaskStore } from "./task.store.js";
import { AGENT_NAMES, type AgentTask, type PipelineSnapshot, type PipelineSummary } from "./task.types.js";

export interface PipelineAgents {
  scanner: ScannerPort;
  triager: TriagerPort;
  remediator: RemediatorPort;
}

export interface OrchestratorOptions {
  clock?: () => Date;
  newPipelineSuffix?: () => string;
  onError?: (err: unknown) => void;
}

/** A step failed; the task is already marked failed and the rest of the pipeline is skipped. */
class StepFailed extends Error {}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 1000);

/**
 * Runs scanner -> triager -> remediator strictly one after another, each as its own persisted task.
 * One pipeline per repository at a time. Sequential by design: each agent needs the previous one's output.
 */
export class AgentOrchestrator {
  private readonly active = new Set<string>();
  private readonly inflight = new Set<Promise<void>>();
  private readonly clock: () => Date;
  private readonly newSuffix: () => string;
  private readonly onError: (err: unknown) => void;

  constructor(
    private readonly store: Pick<TaskStore, "repositoryExists" | "create" | "save" | "loadPipeline" | "loadTask" | "listPipelineIds" | "recoverInterrupted">,
    private readonly agents: PipelineAgents,
    options: OrchestratorOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.newSuffix = options.newPipelineSuffix ?? (() => randomBytes(8).toString("hex"));
    this.onError = options.onError ?? ((err) => console.error("[agents] pipeline error:", err));
  }

  /** Marks tasks left running/queued by a crash as failed/skipped. Call once at startup. */
  recoverInterrupted(): Promise<number> {
    return this.store.recoverInterrupted();
  }

  /** Resolves when no pipeline is running. Used by tests and graceful shutdown. */
  async waitForIdle(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  async start(repositoryId: string): Promise<PipelineSnapshot> {
    if (!(await this.store.repositoryExists(repositoryId))) throw notFound(`Repository "${repositoryId}" not found`);
    // No await between this check and the claim, so two requests cannot both pass it.
    if (this.active.has(repositoryId)) {
      throw new AppError(409, "PIPELINE_ALREADY_RUNNING", `An analysis is already running for repository "${repositoryId}"`);
    }
    this.active.add(repositoryId);

    let tasks: AgentTask[];
    try {
      const pipelineId = `pipe_${createHash("sha256").update(`${repositoryId}|${this.newSuffix()}`).digest("hex").slice(0, 16)}`;
      const createdAt = this.clock().toISOString();
      tasks = AGENT_NAMES.map((agent, seq) => ({
        id: `task_${createHash("sha256").update(`${pipelineId}|${agent}`).digest("hex").slice(0, 16)}`,
        pipelineId,
        repositoryId,
        agent,
        seq,
        status: "queued" as const,
        input: null,
        output: null,
        detail: null,
        createdAt,
        startedAt: null,
        finishedAt: null,
        handedOffTo: null,
      }));
      tasks.forEach((t, i) => {
        t.handedOffTo = tasks[i + 1]?.id ?? null;
      });
      await this.store.create(tasks);
    } catch (err) {
      this.active.delete(repositoryId);
      throw err;
    }

    const snapshot = this.snapshot(tasks.map((t) => ({ ...t })));
    const job: Promise<void> = this.runPipeline(tasks)
      .catch((err) => this.onError(err))
      .finally(() => {
        this.active.delete(repositoryId);
        this.inflight.delete(job);
      });
    this.inflight.add(job);
    return snapshot;
  }

  async getPipeline(pipelineId: string): Promise<PipelineSnapshot> {
    const tasks = await this.store.loadPipeline(pipelineId);
    if (tasks.length === 0) throw notFound(`Pipeline "${pipelineId}" not found`);
    return this.snapshot(tasks);
  }

  async getTask(taskId: string): Promise<AgentTask> {
    const task = await this.store.loadTask(taskId);
    if (!task) throw notFound(`Task "${taskId}" not found`);
    return task;
  }

  async listPipelines(repositoryId: string, limit = 20): Promise<PipelineSummary[]> {
    const ids = await this.store.listPipelineIds(repositoryId, limit);
    const out: PipelineSummary[] = [];
    for (const id of ids) {
      const s = this.snapshot(await this.store.loadPipeline(id));
      out.push({
        id: s.id,
        repositoryId: s.repositoryId,
        status: s.status,
        createdAt: s.createdAt,
        tasks: s.tasks.map((t) => ({ id: t.id, agent: t.agent, status: t.status, detail: t.detail })),
      });
    }
    return out;
  }

  private snapshot(tasks: AgentTask[]): PipelineSnapshot {
    const first = tasks[0] as AgentTask;
    return { id: first.pipelineId, repositoryId: first.repositoryId, status: pipelineStatus(tasks), createdAt: first.createdAt, tasks };
  }

  private async runPipeline(tasks: AgentTask[]): Promise<void> {
    const repositoryId = (tasks[0] as AgentTask).repositoryId;
    try {
      const scanned = await this.step(tasks, 0, { repositoryId }, (i) => this.agents.scanner.run(i));
      const triaged = await this.step(tasks, 1, scanned, (i) => this.agents.triager.run(i));
      const handoff = toRemediatorInput(triaged);
      if (handoff.vulnerabilityIds.length === 0) {
        await this.skip(tasks, 2, "No actionable findings after triage, so there is nothing to remediate.");
      } else {
        await this.step(tasks, 2, handoff, (i) => this.agents.remediator.run(i));
      }
    } catch (err) {
      if (!(err instanceof StepFailed)) this.onError(err);
      await this.finalizeUnfinished(tasks, err instanceof StepFailed ? "an earlier agent failed" : "pipeline error");
    }
  }

  /** queued -> running -> succeeded | failed, persisting every change. Throws StepFailed on failure. */
  private async step<I, O>(tasks: AgentTask[], index: number, input: I, run: (input: I) => Promise<O>): Promise<O> {
    let task = transition(tasks[index] as AgentTask, "running", this.clock(), { input });
    tasks[index] = task;
    await this.store.save(task);
    let output: O;
    try {
      output = await run(input);
    } catch (err) {
      task = transition(task, "failed", this.clock(), { detail: message(err) });
      tasks[index] = task;
      await this.store.save(task);
      throw new StepFailed(message(err));
    }
    task = transition(task, "succeeded", this.clock(), { output });
    tasks[index] = task;
    await this.store.save(task);
    return output;
  }

  private async skip(tasks: AgentTask[], index: number, reason: string): Promise<void> {
    const task = transition(tasks[index] as AgentTask, "skipped", this.clock(), { detail: reason });
    tasks[index] = task;
    await this.store.save(task);
  }

  /** After a failure: anything still queued is skipped; anything still running is failed. Best effort. */
  private async finalizeUnfinished(tasks: AgentTask[], reason: string): Promise<void> {
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i] as AgentTask;
      try {
        if (t.status === "queued") await this.skip(tasks, i, `Skipped because ${reason}.`);
        else if (t.status === "running") {
          tasks[i] = transition(t, "failed", this.clock(), { detail: reason });
          await this.store.save(tasks[i] as AgentTask);
        }
      } catch (err) {
        this.onError(err);
      }
    }
  }
}
