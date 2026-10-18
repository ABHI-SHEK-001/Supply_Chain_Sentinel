export const AGENT_NAMES = ["scanner", "triager", "remediator"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const TASK_STATUSES = ["queued", "running", "succeeded", "failed", "skipped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface AgentTask {
  id: string;
  pipelineId: string;
  repositoryId: string;
  agent: AgentName;
  /** Position in the pipeline; agents run strictly in this order. */
  seq: number;
  status: TaskStatus;
  /** What the previous agent handed over (the first task gets the pipeline request). */
  input: unknown;
  output: unknown;
  /** Failure message or the reason the task was skipped. */
  detail: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** The next task in the pipeline, linked by a HANDED_OFF_TO relationship. */
  handedOffTo: string | null;
}

export type PipelineStatus = "running" | "succeeded" | "failed";

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
