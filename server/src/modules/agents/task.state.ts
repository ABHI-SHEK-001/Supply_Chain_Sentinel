import type { AgentTask, PipelineStatus, TaskStatus } from "./task.types.js";

/** The only legal task transitions. succeeded, failed and skipped are terminal. */
const ALLOWED: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["running", "skipped", "failed"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  skipped: [],
};

export const isTerminal = (s: TaskStatus): boolean => ALLOWED[s].length === 0;
export const canTransition = (from: TaskStatus, to: TaskStatus): boolean => ALLOWED[from].includes(to);

export interface TransitionPatch {
  input?: unknown;
  output?: unknown;
  detail?: string | null;
}

/** Returns a new task in state `to`, or throws if the move is not allowed. Never mutates. */
export function transition(task: AgentTask, to: TaskStatus, now: Date, patch: TransitionPatch = {}): AgentTask {
  if (!canTransition(task.status, to)) {
    throw new Error(`Illegal task transition ${task.status} -> ${to} for ${task.id}`);
  }
  const stamp = now.toISOString();
  return {
    ...task,
    status: to,
    input: "input" in patch ? patch.input : task.input,
    output: "output" in patch ? patch.output : task.output,
    detail: "detail" in patch ? (patch.detail ?? null) : task.detail,
    startedAt: to === "running" ? stamp : task.startedAt,
    finishedAt: isTerminal(to) ? stamp : task.finishedAt,
  };
}

export function pipelineStatus(tasks: readonly Pick<AgentTask, "status">[]): PipelineStatus {
  if (tasks.some((t) => t.status === "queued" || t.status === "running")) return "running";
  return tasks.some((t) => t.status === "failed") ? "failed" : "succeeded";
}
