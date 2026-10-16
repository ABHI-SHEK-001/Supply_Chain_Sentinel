// Edge direction convention (used by all queries):
//   (Repository)-[:CONTAINS]->(PackageVersion)
//   (PackageVersion A)-[:DEPENDS_ON]->(PackageVersion B)   means "A requires B"
//   (PackageVersion)-[:AFFECTED_BY]->(Vulnerability)
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
  "AFFECTED_BY",
  "ANALYZED_IN",
  "HAS_PLAN",
  "TARGETS",
  "UPGRADES",
  "RECORDED",
  "RELATED_TO",
  "HANDLED_BY",
] as const;

export type NodeLabel = (typeof NODE_LABELS)[number];
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export function packageVersionId(ecosystem: string, name: string, version: string): string {
  return `${ecosystem}:${name}@${version}`;
}