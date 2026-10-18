import { repositoryNodeId } from "../../infrastructure/graph/schema.js";
import type { GraphLike } from "../../shared/types/common.js";
import type { AgentName, AgentTask, TaskStatus } from "./task.types.js";

// Constant Cypher only; every value travels as a parameter. Absent values are stored as "".
const REPOSITORY_EXISTS = "MATCH (r:Repository {id: $id}) RETURN r.id AS id";

const UPSERT_TASK =
  "MERGE (t:AgentTask {id: $id}) " +
  "SET t.pipelineId = $pipelineId, t.repositoryId = $repositoryId, t.agent = $agent, t.seq = $seq, " +
  "t.status = $status, t.inputJson = $inputJson, t.outputJson = $outputJson, t.detail = $detail, " +
  "t.createdAt = coalesce(t.createdAt, $createdAt), t.startedAt = $startedAt, t.finishedAt = $finishedAt, " +
  "t.updatedAt = $now";

const LINK_REPOSITORY =
  "MATCH (r:Repository {id: $repositoryNodeId}) MATCH (t:AgentTask {id: $id}) MERGE (r)-[:HAS_TASK]->(t)";

const LINK_HANDOFF =
  "MATCH (a:AgentTask {id: $from}) MATCH (b:AgentTask {id: $to}) MERGE (a)-[:HANDED_OFF_TO]->(b)";

const TASK_COLUMNS =
  "t.id AS id, t.pipelineId AS pipelineId, t.repositoryId AS repositoryId, t.agent AS agent, t.seq AS seq, " +
  "t.status AS status, t.inputJson AS inputJson, t.outputJson AS outputJson, t.detail AS detail, " +
  "t.createdAt AS createdAt, t.startedAt AS startedAt, t.finishedAt AS finishedAt, n.id AS handedOffTo";

const LOAD_PIPELINE =
  "MATCH (t:AgentTask {pipelineId: $pipelineId}) OPTIONAL MATCH (t)-[:HANDED_OFF_TO]->(n:AgentTask) " +
  "RETURN " + TASK_COLUMNS + " ORDER BY t.seq";

const LOAD_TASK =
  "MATCH (t:AgentTask {id: $id}) OPTIONAL MATCH (t)-[:HANDED_OFF_TO]->(n:AgentTask) RETURN " + TASK_COLUMNS;

const LIST_PIPELINE_IDS =
  "MATCH (t:AgentTask {repositoryId: $repositoryId}) WHERE t.seq = 0 " +
  "RETURN t.pipelineId AS pipelineId, t.createdAt AS createdAt ORDER BY t.createdAt DESC";

const COUNT_UNFINISHED =
  "MATCH (t:AgentTask) WHERE t.status IN ['queued', 'running'] RETURN count(t) AS c";

const RECOVER_RUNNING =
  "MATCH (t:AgentTask) WHERE t.status = 'running' " +
  "SET t.status = 'failed', t.detail = $detail, t.finishedAt = $now, t.updatedAt = $now";

const RECOVER_QUEUED =
  "MATCH (t:AgentTask) WHERE t.status = 'queued' " +
  "SET t.status = 'skipped', t.detail = $detail, t.finishedAt = $now, t.updatedAt = $now";

interface TaskRow {
  id: string;
  pipelineId: string;
  repositoryId: string;
  agent: AgentName;
  seq: number;
  status: TaskStatus;
  inputJson: string | null;
  outputJson: string | null;
  detail: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  handedOffTo: string | null;
}

const MAX_JSON_CHARS = 1_000_000;

function encode(value: unknown): string {
  if (value === undefined || value === null) return "";
  const json = JSON.stringify(value);
  if (json.length <= MAX_JSON_CHARS) return json;
  return JSON.stringify({ truncated: true, originalLength: json.length });
}

function decode(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

const blankToNull = (s: string | null | undefined): string | null => (s ? s : null);

function toTask(r: TaskRow): AgentTask {
  return {
    id: r.id,
    pipelineId: r.pipelineId,
    repositoryId: r.repositoryId,
    agent: r.agent,
    seq: Number(r.seq),
    status: r.status,
    input: decode(r.inputJson),
    output: decode(r.outputJson),
    detail: blankToNull(r.detail),
    createdAt: r.createdAt,
    startedAt: blankToNull(r.startedAt),
    finishedAt: blankToNull(r.finishedAt),
    handedOffTo: blankToNull(r.handedOffTo),
  };
}

export class TaskStore {
  constructor(
    private readonly graph: GraphLike,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async repositoryExists(slug: string): Promise<boolean> {
    const res = await this.graph.readQuery<{ id: string }>(REPOSITORY_EXISTS, { id: repositoryNodeId(slug) });
    return Boolean(res.data?.[0]);
  }

  /** Persists a new pipeline's tasks and links them: repository -> task, and each task -> the next. */
  async create(tasks: readonly AgentTask[]): Promise<void> {
    for (const t of tasks) {
      await this.save(t);
      await this.graph.query(LINK_REPOSITORY, { id: t.id, repositoryNodeId: repositoryNodeId(t.repositoryId) });
    }
    for (let i = 0; i + 1 < tasks.length; i++) {
      await this.graph.query(LINK_HANDOFF, { from: (tasks[i] as AgentTask).id, to: (tasks[i + 1] as AgentTask).id });
    }
  }

  async save(t: AgentTask): Promise<void> {
    await this.graph.query(UPSERT_TASK, {
      id: t.id,
      pipelineId: t.pipelineId,
      repositoryId: t.repositoryId,
      agent: t.agent,
      seq: t.seq,
      status: t.status,
      inputJson: encode(t.input),
      outputJson: encode(t.output),
      detail: t.detail ?? "",
      createdAt: t.createdAt,
      startedAt: t.startedAt ?? "",
      finishedAt: t.finishedAt ?? "",
      now: this.clock().toISOString(),
    });
  }

  async loadPipeline(pipelineId: string): Promise<AgentTask[]> {
    return ((await this.graph.readQuery<TaskRow>(LOAD_PIPELINE, { pipelineId })).data ?? []).map(toTask);
  }

  async loadTask(id: string): Promise<AgentTask | null> {
    const row = (await this.graph.readQuery<TaskRow>(LOAD_TASK, { id })).data?.[0];
    return row ? toTask(row) : null;
  }

  async listPipelineIds(repositoryId: string, limit: number): Promise<string[]> {
    const rows = (await this.graph.readQuery<{ pipelineId: string }>(LIST_PIPELINE_IDS, { repositoryId })).data ?? [];
    return rows.slice(0, limit).map((r) => r.pipelineId);
  }

  /**
   * Called once at startup. Anything still queued or running was interrupted by a crash or restart:
   * running tasks become failed, queued tasks become skipped. Returns how many tasks were touched.
   */
  async recoverInterrupted(): Promise<number> {
    const count = Number((await this.graph.readQuery<{ c: number }>(COUNT_UNFINISHED)).data?.[0]?.c ?? 0);
    if (count === 0) return 0;
    const now = this.clock().toISOString();
    await this.graph.query(RECOVER_RUNNING, { detail: "interrupted by a server restart", now });
    await this.graph.query(RECOVER_QUEUED, { detail: "pipeline was interrupted by a server restart before this task started", now });
    return count;
  }
}
