// Edge direction convention (used by all queries):
//   (Repository)-[:CONTAINS]->(PackageVersion)        direct=true marks the repo's direct dependencies
//   (PackageVersion A)-[:DEPENDS_ON]->(PackageVersion B)   means "A requires B"
//   (PackageVersion)-[:VERSION_OF]->(Package)
//   (PackageVersion)-[:AFFECTED_BY]->(Vulnerability)
//
// Repository scoping: PackageVersion/Package/Vulnerability nodes are shared across
// repositories, but the same resolved version can depend on different resolved versions
// in different lockfiles. So CONTAINS is naturally per-repository, and every DEPENDS_ON
// edge carries `repositoryId`. Traversals MUST filter DEPENDS_ON by repositoryId.
export const NODE_LABELS = [
  "Repository",
  "Package",
  "PackageVersion",
  "Vulnerability",
  "Analysis",
  "RemediationPlan",
  "Decision",
  "AgentTask",
] as const;


export const RELATIONSHIP_TYPES = [
  "CONTAINS",
  "DEPENDS_ON",
  "VERSION_OF",
  "AFFECTED_BY",
  "ANALYZED_IN",
  "HAS_PLAN",
  "TARGETS",
  "UPGRADES",
  "RECORDED",
  "RELATED_TO",
  "HANDLED_BY",
  "HAS_TASK",
  "HANDED_OFF_TO",
] as const;

export type NodeLabel = (typeof NODE_LABELS)[number];
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export function packageVersionId(ecosystem: string, name: string, version: string): string {
  return `${ecosystem}:${name}@${version}`;
}

export function packageId(ecosystem: string, name: string): string {
  return `${ecosystem}:${name}`;
}

export function repositoryNodeId(slug: string): string {
  return `repo:${slug}`;
}

export function repositorySlugFromNodeId(nodeId: string): string {
  return nodeId.startsWith("repo:") ? nodeId.slice(5) : nodeId;
}