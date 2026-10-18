import { repositoryNodeId, repositorySlugFromNodeId } from "../../infrastructure/graph/schema.js";
import { notFound } from "../../shared/errors/app-error.js";
import type { GraphLike } from "../../shared/types/common.js";
import {
    DEFAULT_ANALYSIS_OPTIONS,
    type AnalysisOptions,
    type Coverage,
    type FindingExposure,
    type GraphView,
    type RepositoryExposure,
    type VulnerabilityDetail,
    type VulnerabilitySummary,
} from "./graph-analysis.types.js";
import { buildPathGraph, findPathsToTarget, type TargetExposure } from "./dependency-paths.js";

// Constant Cypher only; every value is a parameter. Edge reads are repository-scoped
// because the same package version can depend on different versions in other lockfiles.
const REPOSITORY_EXISTS = "MATCH (r:Repository {id: $id}) RETURN r.id AS id";

const LOAD_NODES =
    "MATCH (:Repository {id: $id})-[c:CONTAINS]->(v:PackageVersion) " +
    "RETURN v.id AS id, v.ecosystem AS ecosystem, v.name AS name, v.version AS version, " +
    "c.direct AS direct, c.dev AS dev, c.optional AS optional, v.osvCheckedAt AS osvCheckedAt ORDER BY v.id";

const LOAD_EDGES =
    "MATCH (a:PackageVersion)-[d:DEPENDS_ON {repositoryId: $id}]->(b:PackageVersion) " +
    "RETURN a.id AS src, b.id AS dst, d.kind AS kind ORDER BY a.id, b.id";

const FINDING_COLUMNS =
    "RETURN x.id AS vulnerabilityId, v.id AS packageVersionId, x.summary AS summary, " +
    "x.severityLabel AS severityLabel, x.sourceUrl AS sourceUrl, x.detailsStatus AS detailsStatus, " +
    "a.fixedVersions AS fixedVersions ORDER BY x.id, v.id";

const LOAD_FINDINGS =
    "MATCH (:Repository {id: $id})-[:CONTAINS]->(v:PackageVersion)-[a:AFFECTED_BY]->(x:Vulnerability) " +
    FINDING_COLUMNS;

const LOAD_FINDINGS_FOR_VULNERABILITY =
    "MATCH (:Repository {id: $id})-[:CONTAINS]->(v:PackageVersion)-[a:AFFECTED_BY]->(x:Vulnerability {id: $vulnerabilityId}) " +
    FINDING_COLUMNS;

const LIST_FINDING_ROWS =
    "MATCH (r:Repository)-[:CONTAINS]->(v:PackageVersion)-[:AFFECTED_BY]->(x:Vulnerability) " +
    "RETURN x.id AS id, x.summary AS summary, x.severityLabel AS severityLabel, x.sourceUrl AS sourceUrl, " +
    "x.detailsStatus AS detailsStatus, x.aliases AS aliases, r.id AS repositoryId, v.id AS packageVersionId";

const LOAD_VULNERABILITY =
    "MATCH (x:Vulnerability {id: $id}) " +
    "RETURN x.id AS id, x.summary AS summary, x.details AS details, x.aliases AS aliases, " +
    "x.severityLabel AS severityLabel, x.severityJson AS severityJson, x.published AS published, " +
    "x.modified AS modified, x.withdrawn AS withdrawn, x.references AS references, " +
    "x.sourceUrl AS sourceUrl, x.detailsStatus AS detailsStatus, x.lastCheckedAt AS lastCheckedAt";

const AFFECTED_REPOSITORIES =
    "MATCH (r:Repository)-[:CONTAINS]->(:PackageVersion)-[:AFFECTED_BY]->(x:Vulnerability {id: $id}) " +
    "RETURN r.id AS repositoryId";

interface NodeRow {
    id: string;
    ecosystem: string;
    name: string;
    version: string;
    direct: boolean | null;
    dev: boolean | null;
    optional: boolean | null;
    osvCheckedAt: string | null;
}
interface EdgeRow { src: string; dst: string; kind: string | null }
interface FindingRow {
    vulnerabilityId: string;
    packageVersionId: string;
    summary: string | null;
    severityLabel: string | null;
    sourceUrl: string | null;
    detailsStatus: string | null;
    fixedVersions: string[] | null;
}
interface ListRow {
    id: string;
    summary: string | null;
    severityLabel: string | null;
    sourceUrl: string | null;
    detailsStatus: string | null;
    aliases: string[] | null;
    repositoryId: string;
    packageVersionId: string;
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MODERATE: 2, MEDIUM: 2, LOW: 1 };
const rank = (label: string | null): number => (label ? (SEVERITY_RANK[label] ?? 0) : 0);

function parseJsonArray(text: string | null): unknown[] | null {
    if (!text) return null;
    try {
        const value: unknown = JSON.parse(text);
        return Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

export class GraphAnalysisService {
    constructor(
        private readonly graph: GraphLike,
        private readonly clock: () => Date = () => new Date(),
    ) { }

    private async loadModel(slug: string) {
        const id = repositoryNodeId(slug);
        const exists = await this.graph.readQuery<{ id: string }>(REPOSITORY_EXISTS, { id });
        if (!exists.data?.[0]) throw notFound(`Repository "${slug}" not found`);
        const nodes = (await this.graph.readQuery<NodeRow>(LOAD_NODES, { id })).data ?? [];
        const edges = (await this.graph.readQuery<EdgeRow>(LOAD_EDGES, { id })).data ?? [];
        return { id, nodes, edges };
    }

    private async loadFindings(id: string, vulnerabilityId?: string): Promise<FindingRow[]> {
        const res = vulnerabilityId
            ? await this.graph.readQuery<FindingRow>(LOAD_FINDINGS_FOR_VULNERABILITY, { id, vulnerabilityId })
            : await this.graph.readQuery<FindingRow>(LOAD_FINDINGS, { id });
        return res.data ?? [];
    }

    async getGraph(slug: string, limit = 5000): Promise<GraphView> {
        const { id, nodes, edges } = await this.loadModel(slug);
        const findings = await this.loadFindings(id);
        const byPackage = new Map<string, string[]>();
        for (const f of findings) {
            const list = byPackage.get(f.packageVersionId) ?? [];
            list.push(f.vulnerabilityId);
            byPackage.set(f.packageVersionId, list);
        }
        const kept = nodes.slice(0, limit);
        const keptIds = new Set(kept.map((n) => n.id));
        const keptEdges = edges.filter((e) => keptIds.has(e.src) && keptIds.has(e.dst));
        return {
            repositoryId: slug,
            totalNodes: nodes.length,
            totalEdges: edges.length,
            truncated: kept.length < nodes.length,
            nodes: kept.map((n) => ({
                id: n.id,
                ecosystem: n.ecosystem,
                name: n.name,
                version: n.version,
                direct: n.direct === true,
                dev: n.dev === true,
                optional: n.optional === true,
                vulnerabilityIds: [...new Set(byPackage.get(n.id) ?? [])].sort(),
            })),
            edges: keptEdges.map((e) => ({ source: e.src, target: e.dst, kind: e.kind ?? "prod" })),
        };
    }

    async analyzeRepository(
        slug: string,
        options: Partial<AnalysisOptions> & { vulnerabilityId?: string } = {},
    ): Promise<RepositoryExposure> {
        const opts: AnalysisOptions = {
            maxDepth: options.maxDepth ?? DEFAULT_ANALYSIS_OPTIONS.maxDepth,
            maxPathsPerFinding: options.maxPathsPerFinding ?? DEFAULT_ANALYSIS_OPTIONS.maxPathsPerFinding,
        };
        const { id, nodes, edges } = await this.loadModel(slug);
        const findings = await this.loadFindings(id, options.vulnerabilityId);

        const nodeById = new Map(nodes.map((n) => [n.id, n]));
        const graph = buildPathGraph({
            nodeIds: nodes.map((n) => n.id),
            directIds: nodes.filter((n) => n.direct === true).map((n) => n.id),
            edges: edges.map((e) => ({ from: e.src, to: e.dst })),
        });

        const exposureByTarget = new Map<string, TargetExposure>();
        const exposureOf = (target: string): TargetExposure => {
            let found = exposureByTarget.get(target);
            if (!found) {
                found = findPathsToTarget(graph, target, { maxDepth: opts.maxDepth, maxPaths: opts.maxPathsPerFinding });
                exposureByTarget.set(target, found);
            }
            return found;
        };

        const exposures: FindingExposure[] = findings.flatMap((f): FindingExposure[] => {
            const node = nodeById.get(f.packageVersionId);
            if (!node) return [];
            const exposure = exposureOf(f.packageVersionId);
            return [
                {
                    vulnerability: {
                        id: f.vulnerabilityId,
                        summary: f.summary ?? null,
                        severityLabel: f.severityLabel ?? null,
                        sourceUrl: f.sourceUrl ?? null,
                        detailsStatus: f.detailsStatus ?? null,
                    },
                    affected: {
                        packageVersionId: node.id,
                        ecosystem: node.ecosystem,
                        name: node.name,
                        version: node.version,
                        fixedVersions: f.fixedVersions ?? null,
                    },
                    direct: node.direct === true,
                    reachableFromRoot: exposure.reachable,
                    entryPoints: exposure.entryPoints,
                    shortestPathLength: exposure.shortestPathLength,
                    paths: exposure.paths.map((p) => ({
                        length: p.length - 1,
                        devOnly: nodeById.get(p[0] as string)?.dev === true,
                        nodes: p,
                    })),
                    pathsTruncated: exposure.truncation !== null,
                    truncation: exposure.truncation,
                },
            ];
        });

        exposures.sort(
            (a, b) =>
                rank(b.vulnerability.severityLabel) - rank(a.vulnerability.severityLabel) ||
                a.vulnerability.id.localeCompare(b.vulnerability.id) ||
                a.affected.packageVersionId.localeCompare(b.affected.packageVersionId),
        );

        const bySeverity: Record<string, number> = {};
        for (const e of exposures) {
            const key = e.vulnerability.severityLabel ?? "UNKNOWN";
            bySeverity[key] = (bySeverity[key] ?? 0) + 1;
        }

        return {
            repositoryId: slug,
            analyzedAt: this.clock().toISOString(),
            options: opts,
            coverage: this.coverage(nodes),
            summary: {
                findingCount: exposures.length,
                vulnerabilityCount: new Set(exposures.map((e) => e.vulnerability.id)).size,
                directlyAffectedCount: exposures.filter((e) => e.direct).length,
                bySeverity,
            },
            findings: exposures,
        };
    }

    private coverage(nodes: NodeRow[]): Coverage {
        const checked = nodes.filter((n) => n.osvCheckedAt);
        const lastCheckedAt = checked.reduce<string | null>(
            (latest, n) => (latest === null || (n.osvCheckedAt as string) > latest ? (n.osvCheckedAt as string) : latest),
            null,
        );
        return {
            packagesTotal: nodes.length,
            packagesChecked: checked.length,
            packagesUnchecked: nodes.length - checked.length,
            lastCheckedAt,
            complete: nodes.length > 0 && checked.length === nodes.length,
        };
    }

    async listVulnerabilities(limit = 100): Promise<{ total: number; items: VulnerabilitySummary[] }> {
        const rows = (await this.graph.readQuery<ListRow>(LIST_FINDING_ROWS)).data ?? [];
        const grouped = new Map<string, VulnerabilitySummary & { _pv: Set<string>; _repos: Set<string> }>();
        for (const r of rows) {
            let g = grouped.get(r.id);
            if (!g) {
                g = {
                    id: r.id,
                    summary: r.summary ?? null,
                    severityLabel: r.severityLabel ?? null,
                    sourceUrl: r.sourceUrl ?? null,
                    detailsStatus: r.detailsStatus ?? null,
                    aliases: r.aliases ?? [],
                    repositoryCount: 0,
                    packageVersionCount: 0,
                    repositories: [],
                    _pv: new Set(),
                    _repos: new Set(),
                };
                grouped.set(r.id, g);
            }
            g._pv.add(r.packageVersionId);
            g._repos.add(repositorySlugFromNodeId(r.repositoryId));
        }
        const all: VulnerabilitySummary[] = [...grouped.values()].map(({ _pv, _repos, ...rest }) => ({
            ...rest,
            repositories: [..._repos].sort(),
            repositoryCount: _repos.size,
            packageVersionCount: _pv.size,
        }));
        all.sort(
            (a, b) =>
                rank(b.severityLabel) - rank(a.severityLabel) ||
                b.repositoryCount - a.repositoryCount ||
                a.id.localeCompare(b.id),
        );
        return { total: all.length, items: all.slice(0, limit) };
    }

    async getVulnerability(
        vulnerabilityId: string,
        options: Partial<AnalysisOptions> = {},
    ): Promise<VulnerabilityDetail> {
        const res = await this.graph.readQuery<{
            id: string;
            summary: string | null;
            details: string | null;
            aliases: string[] | null;
            severityLabel: string | null;
            severityJson: string | null;
            published: string | null;
            modified: string | null;
            withdrawn: string | null;
            references: string[] | null;
            sourceUrl: string | null;
            detailsStatus: string | null;
            lastCheckedAt: string | null;
        }>(LOAD_VULNERABILITY, { id: vulnerabilityId });
        const row = res.data?.[0];
        if (!row) throw notFound(`Vulnerability "${vulnerabilityId}" not found`);

        const repoRows =
            (await this.graph.readQuery<{ repositoryId: string }>(AFFECTED_REPOSITORIES, { id: vulnerabilityId })).data ?? [];
        const slugs = [...new Set(repoRows.map((r) => repositorySlugFromNodeId(r.repositoryId)))].sort();

        const repositories: VulnerabilityDetail["repositories"] = [];
        for (const slug of slugs) {
            const exposure = await this.analyzeRepository(slug, { ...options, vulnerabilityId });
            repositories.push({ repositoryId: slug, findings: exposure.findings });
        }

        return {
            vulnerability: {
                id: row.id,
                summary: row.summary ?? null,
                details: row.details ?? null,
                aliases: row.aliases ?? [],
                severityLabel: row.severityLabel ?? null,
                severity: parseJsonArray(row.severityJson ?? null),
                published: row.published ?? null,
                modified: row.modified ?? null,
                withdrawn: row.withdrawn ?? null,
                references: row.references ?? [],
                sourceUrl: row.sourceUrl ?? null,
                detailsStatus: row.detailsStatus ?? null,
                lastCheckedAt: row.lastCheckedAt ?? null,
            },
            repositories,
        };
    }
}