import type { IngestionResult } from "../ingestion/dependency-ingestion.service.js";

export interface RepositorySummary {
  /** URL-safe slug, e.g. "acme-web". The graph node id is `repo:<slug>`. */
  id: string;
  name: string;
  ecosystem: string | null;
  lockfileSha256: string | null;
  packageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RegisterRepositoryResult {
  repository: RepositorySummary;
  ingestion: IngestionResult;
}