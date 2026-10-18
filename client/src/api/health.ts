import { get } from './client';
import type { HealthData, ReadinessData } from '../types/api';

/** GET /health — liveness probe, never touches the graph */
export function getHealth(signal?: AbortSignal): Promise<HealthData> {
  return get<HealthData>('/health', { signal });
}

/** GET /api/v1/health — readiness probe with graph connectivity */
export function getReadiness(signal?: AbortSignal): Promise<ReadinessData> {
  return get<ReadinessData>('/api/v1/health', { signal });
}
