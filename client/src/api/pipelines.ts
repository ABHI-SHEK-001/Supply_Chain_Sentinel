import { get, post } from './client';
import type { PipelineSnapshot, PipelineSummary, AgentTask } from '../types/api';

/** POST /api/v1/repositories/:id/analyze — starts async pipeline, returns 202 */
export function startAnalysis(repositoryId: string, signal?: AbortSignal): Promise<PipelineSnapshot> {
  return post<PipelineSnapshot>(`/api/v1/repositories/${encodeURIComponent(repositoryId)}/analyze`, undefined, { signal });
}

/** GET /api/v1/repositories/:id/pipelines */
export function listPipelines(repositoryId: string, signal?: AbortSignal): Promise<PipelineSummary[]> {
  return get<PipelineSummary[]>(`/api/v1/repositories/${encodeURIComponent(repositoryId)}/pipelines`, { signal });
}

/** GET /api/v1/pipelines/:id */
export function getPipeline(pipelineId: string, signal?: AbortSignal): Promise<PipelineSnapshot> {
  return get<PipelineSnapshot>(`/api/v1/pipelines/${encodeURIComponent(pipelineId)}`, { signal });
}

/** GET /api/v1/tasks/:id */
export function getTask(taskId: string, signal?: AbortSignal): Promise<AgentTask> {
  return get<AgentTask>(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { signal });
}
