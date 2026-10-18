import { get, post } from './client';
import type { RemediationPlan, PlanSummary, PlanValidation } from '../types/api';

/** GET /api/v1/remediation-plans?repositoryId=X */
export function listPlans(repositoryId?: string, signal?: AbortSignal): Promise<PlanSummary[]> {
  const q = repositoryId ? `?repositoryId=${encodeURIComponent(repositoryId)}` : '';
  return get<PlanSummary[]>(`/api/v1/remediation-plans${q}`, { signal });
}

/** POST /api/v1/remediation-plans */
export function createPlan(
  body: { repositoryId: string; vulnerabilityIds?: string[] },
  signal?: AbortSignal,
): Promise<RemediationPlan> {
  return post<RemediationPlan>('/api/v1/remediation-plans', body, { signal });
}

/** GET /api/v1/remediation-plans/:id */
export function getPlan(planId: string, signal?: AbortSignal): Promise<RemediationPlan> {
  return get<RemediationPlan>(`/api/v1/remediation-plans/${encodeURIComponent(planId)}`, { signal });
}

/** POST /api/v1/remediation-plans/:id/validate */
export function validatePlan(planId: string, signal?: AbortSignal): Promise<PlanValidation> {
  return post<PlanValidation>(`/api/v1/remediation-plans/${encodeURIComponent(planId)}/validate`, undefined, { signal });
}
