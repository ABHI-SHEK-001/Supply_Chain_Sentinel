import { get, post } from './client';
import type { RepositorySummary, RegisterRepositoryResult, GraphView } from '../types/api';

/** GET /api/v1/repositories */
export function listRepositories(signal?: AbortSignal): Promise<RepositorySummary[]> {
  return get<RepositorySummary[]>('/api/v1/repositories', { signal });
}

/** GET /api/v1/repositories/:id */
export function getRepository(id: string, signal?: AbortSignal): Promise<RepositorySummary> {
  return get<RepositorySummary>(`/api/v1/repositories/${encodeURIComponent(id)}`, { signal });
}

/** GET /api/v1/repositories/:id/graph */
export function getRepositoryGraph(id: string, limit = 5000, signal?: AbortSignal): Promise<GraphView> {
  return get<GraphView>(`/api/v1/repositories/${encodeURIComponent(id)}/graph?limit=${limit}`, { signal });
}

/** POST /api/v1/repositories — register with lockfile */
export function registerRepository(
  body: { name: string; ecosystem?: string; lockfile: string },
  signal?: AbortSignal,
): Promise<RegisterRepositoryResult> {
  return post<RegisterRepositoryResult>('/api/v1/repositories', body, { signal });
}
