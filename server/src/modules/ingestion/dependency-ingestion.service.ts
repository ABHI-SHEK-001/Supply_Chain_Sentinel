import { packageId, repositoryNodeId } from "../../infrastructure/graph/schema.js";
import type { GraphLike } from "../../shared/types/common.js";
import type { ParsedLockfile } from "./lockfile.types.js";

const CHUNK_SIZE = 500;

// All Cypher below is constant text; every variable value travels as a parameter.
const UPSERT_REPOSITORY =
  "MERGE (r:Repository {id: $id}) " +
  "SET r.name = $name, r.ecosystem = $ecosystem, r.lockfileFile = $lockfileFile, " +
  "r.lockfileVersion = $lockfileVersion, r.lockfileSha256 = $lockfileSha256, " +
  "r.rootName = $rootName, r.rootVersion = $rootVersion, " +
  "r.createdAt = coalesce(r.createdAt, $now), r.updatedAt = $now";

const UPSERT_PACKAGES =
  "UNWIND $packages AS p " +
  "MERGE (pkg:Package {id: p.packageId}) " +
  "SET pkg.ecosystem = p.ecosystem, pkg.name = p.name " +
  "MERGE (v:PackageVersion {id: p.id}) " +
  "SET v.ecosystem = p.ecosystem, v.name = p.name, v.version = p.version " +
  "MERGE (v)-[:VERSION_OF]->(pkg)";

const LINK_CONTAINS =
  "UNWIND $packages AS p " +
  "MATCH (r:Repository {id: $repositoryId}) " +
  "MATCH (v:PackageVersion {id: p.id}) " +
  "MERGE (r)-[c:CONTAINS]->(v) " +
  "SET c.direct = p.direct, c.dev = p.dev, c.optional = p.optional, " +
  "c.lockfilePaths = p.lockfilePaths, c.resolved = p.resolved, c.integrity = p.integrity, " +
  "c.ingestionId = $ingestionId";

const LINK_DEPENDS_ON =
  "UNWIND $edges AS e " +
  "MATCH (a:PackageVersion {id: e.from}) " +
  "MATCH (b:PackageVersion {id: e.to}) " +
  "MERGE (a)-[d:DEPENDS_ON {repositoryId: $repositoryId}]->(b) " +
  "SET d.kind = e.kind, d.range = e.range, d.ingestionId = $ingestionId";

const DELETE_STALE_CONTAINS =
  "MATCH (:Repository {id: $repositoryId})-[c:CONTAINS]->(:PackageVersion) " +
  "WHERE c.ingestionId <> $ingestionId DELETE c";

const DELETE_STALE_DEPENDS_ON =
  "MATCH (:PackageVersion)-[d:DEPENDS_ON {repositoryId: $repositoryId}]->(:PackageVersion) " +
  "WHERE d.ingestionId <> $ingestionId DELETE d";

export interface IngestInput {
  repositorySlug: string;
  lockfileSha256: string;
  parsed: ParsedLockfile;
}

export interface IngestionResult {
  repositoryId: string;
  ingestionId: string;
  packageCount: number;
  dependencyEdgeCount: number;
  directDependencyCount: number;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Writes a parsed lockfile into the graph.
 *
 * Idempotent: every write is a MERGE on a stable id, so re-running with the same input
 * changes nothing. Relationships written in a run are stamped with `ingestionId` (the
 * lockfile hash); afterwards this repository's relationships with a different stamp are
 * deleted, so removed dependencies disappear without ever leaving the repo empty
 * mid-run. Individual queries are atomic but the sequence is not one transaction: a
 * failure part-way leaves a partial state that the next successful run converges.
 */
export class DependencyIngestionService {
  constructor(
    private readonly graph: GraphLike,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async ingest(input: IngestInput): Promise<IngestionResult> {
    const { parsed } = input;
    const repositoryId = repositoryNodeId(input.repositorySlug);
    const ingestionId = input.lockfileSha256;

    await this.graph.query(UPSERT_REPOSITORY, {
      id: repositoryId,
      name: input.repositorySlug,
      ecosystem: parsed.ecosystem,
      lockfileFile: parsed.source.file,
      lockfileVersion: parsed.source.lockfileVersion,
      lockfileSha256: input.lockfileSha256,
      rootName: parsed.root.name ?? null,
      rootVersion: parsed.root.version ?? null,
      now: this.clock().toISOString(),
    });

    const packages = parsed.packages.map((p) => ({
      id: p.id,
      packageId: packageId(p.ecosystem, p.name),
      ecosystem: p.ecosystem,
      name: p.name,
      version: p.version,
      direct: p.direct,
      dev: p.dev,
      optional: p.optional,
      lockfilePaths: p.lockfilePaths,
      resolved: p.resolved ?? null,
      integrity: p.integrity ?? null,
    }));
    for (const part of chunk(packages, CHUNK_SIZE)) {
      await this.graph.query(UPSERT_PACKAGES, { packages: part });
    }
    for (const part of chunk(packages, CHUNK_SIZE)) {
      await this.graph.query(LINK_CONTAINS, { repositoryId, ingestionId, packages: part });
    }

    const edges = parsed.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, range: e.range }));
    for (const part of chunk(edges, CHUNK_SIZE)) {
      await this.graph.query(LINK_DEPENDS_ON, { repositoryId, ingestionId, edges: part });
    }

    await this.graph.query(DELETE_STALE_CONTAINS, { repositoryId, ingestionId });
    await this.graph.query(DELETE_STALE_DEPENDS_ON, { repositoryId, ingestionId });

    return {
      repositoryId,
      ingestionId,
      packageCount: packages.length,
      dependencyEdgeCount: edges.length,
      directDependencyCount: parsed.directDependencies.length,
    };
  }
}