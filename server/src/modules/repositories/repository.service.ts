import { createHash } from "node:crypto";
import { repositoryNodeId, repositorySlugFromNodeId } from "../../infrastructure/graph/schema.js";
import { badRequest, notFound } from "../../shared/errors/app-error.js";
import type { GraphLike } from "../../shared/types/common.js";
import type { DependencyIngestionService } from "../ingestion/dependency-ingestion.service.js";
import type { LockfileParser } from "../ingestion/lockfile.types.js";
import { NpmLockfileParser } from "../ingestion/npm-lockfile.parser.js";
import type { CreateRepositoryInput } from "./repository.schemas.js";
import type { RegisterRepositoryResult, RepositorySummary } from "./repository.types.js";

interface Row {
  id: string;
  name: string | null;
  ecosystem: string | null;
  lockfileSha256: string | null;
  packageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

const SUMMARY_RETURN =
  "RETURN r.id AS id, r.name AS name, r.ecosystem AS ecosystem, " +
  "r.lockfileSha256 AS lockfileSha256, r.createdAt AS createdAt, r.updatedAt AS updatedAt, " +
  "count(v) AS packageCount";

const LIST_REPOSITORIES =
  "MATCH (r:Repository) OPTIONAL MATCH (r)-[:CONTAINS]->(v:PackageVersion) " +
  SUMMARY_RETURN +
  " ORDER BY r.id";

const GET_REPOSITORY =
  "MATCH (r:Repository {id: $id}) OPTIONAL MATCH (r)-[:CONTAINS]->(v:PackageVersion) " +
  SUMMARY_RETURN;

function toSummary(row: Row): RepositorySummary {
  const id = repositorySlugFromNodeId(row.id);
  return {
    id,
    name: row.name ?? id,
    ecosystem: row.ecosystem ?? null,
    lockfileSha256: row.lockfileSha256 ?? null,
    packageCount: Number(row.packageCount ?? 0),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export class RepositoryService {
  constructor(
    private readonly graph: GraphLike,
    private readonly ingestion: Pick<DependencyIngestionService, "ingest">,
    private readonly parsers: readonly LockfileParser[] = [new NpmLockfileParser()],
  ) {}

  async register(input: CreateRepositoryInput): Promise<RegisterRepositoryResult> {
    const parser = this.parsers.find((p) => p.ecosystem === input.ecosystem);
    if (!parser) throw badRequest(`Unsupported ecosystem: ${input.ecosystem}`);

    // Parse and validate fully before touching the graph.
    const parsed = parser.parse(input.lockfile);
    const lockfileSha256 = createHash("sha256").update(input.lockfile).digest("hex");

    const ingestion = await this.ingestion.ingest({
      repositorySlug: input.name,
      lockfileSha256,
      parsed,
    });
    const repository = await this.get(input.name);
    return { repository, ingestion };
  }

  async list(): Promise<RepositorySummary[]> {
    const res = await this.graph.readQuery<Row>(LIST_REPOSITORIES);
    return (res.data ?? []).map(toSummary);
  }

  async get(slug: string): Promise<RepositorySummary> {
    const res = await this.graph.readQuery<Row>(GET_REPOSITORY, { id: repositoryNodeId(slug) });
    const row = res.data?.[0];
    if (!row || row.id === null || row.id === undefined) {
      throw notFound(`Repository "${slug}" not found`);
    }
    return toSummary(row);
  }
}