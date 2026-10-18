import { get } from './client';
import type { RepositoryExposure, VulnerabilitySummary, VulnerabilityDetail } from '../types/api';

/** GET /api/v1/repositories/:id/vulnerabilities */
export function getRepositoryVulnerabilities(
  repositoryId: string,
  params?: { maxDepth?: number; maxPaths?: number; vulnerabilityId?: string },
  signal?: AbortSignal,
): Promise<RepositoryExposure> {
  const qs = new URLSearchParams();
  if (params?.maxDepth) qs.set('maxDepth', String(params.maxDepth));
  if (params?.maxPaths) qs.set('maxPaths', String(params.maxPaths));
  if (params?.vulnerabilityId) qs.set('vulnerabilityId', params.vulnerabilityId);
  const q = qs.toString();
  return get<RepositoryExposure>(
    `/api/v1/repositories/${encodeURIComponent(repositoryId)}/vulnerabilities${q ? `?${q}` : ''}`,
    { signal },
  );
}

export interface VulnerabilitiesResult {
  total: number;
  items: VulnerabilitySummary[];
}

/** GET /api/v1/vulnerabilities?limit=N */
export async function listVulnerabilities(limit = 100, signal?: AbortSignal): Promise<VulnerabilitySummary[]> {
  const res = await get<VulnerabilitiesResult | VulnerabilitySummary[]>(`/api/v1/vulnerabilities?limit=${limit}`, { signal });
  if (Array.isArray(res)) return res;
  if (res && Array.isArray((res as VulnerabilitiesResult).items)) {
    return (res as VulnerabilitiesResult).items;
  }
  return [];
}

/** GET /api/v1/vulnerabilities/:id */
export function getVulnerability(
  id: string,
  params?: { maxDepth?: number; maxPaths?: number },
  signal?: AbortSignal,
): Promise<VulnerabilityDetail> {
  const qs = new URLSearchParams();
  if (params?.maxDepth) qs.set('maxDepth', String(params.maxDepth));
  if (params?.maxPaths) qs.set('maxPaths', String(params.maxPaths));
  const q = qs.toString();
  return get<VulnerabilityDetail>(
    `/api/v1/vulnerabilities/${encodeURIComponent(id)}${q ? `?${q}` : ''}`,
    { signal },
  );
}
