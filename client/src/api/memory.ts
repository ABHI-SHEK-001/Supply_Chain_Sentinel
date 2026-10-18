import { get, post } from './client';
import type { Decision, RecordDecisionInput, DecisionSearch } from '../types/api';

/** GET /api/v1/memory?repositoryId=X&... */
export function searchDecisions(params: DecisionSearch, signal?: AbortSignal): Promise<Decision[]> {
  const qs = new URLSearchParams();
  qs.set('repositoryId', params.repositoryId);
  if (params.type) qs.set('type', params.type);
  if (params.vulnerabilityId) qs.set('vulnerabilityId', params.vulnerabilityId);
  if (params.packageVersionId) qs.set('packageVersionId', params.packageVersionId);
  if (params.status) qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
  if (params.limit) qs.set('limit', String(params.limit));
  return get<Decision[]>(`/api/v1/memory?${qs.toString()}`, { signal });
}

/** POST /api/v1/memory */
export function recordDecision(input: RecordDecisionInput, signal?: AbortSignal): Promise<Decision> {
  return post<Decision>('/api/v1/memory', input, { signal });
}

/** POST /api/v1/memory/:id/revoke */
export function revokeDecision(
  decisionId: string,
  body: { repositoryId: string; reason?: string },
  signal?: AbortSignal,
): Promise<Decision> {
  return post<Decision>(`/api/v1/memory/${encodeURIComponent(decisionId)}/revoke`, body, { signal });
}
