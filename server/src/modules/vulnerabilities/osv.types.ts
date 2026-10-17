import { z } from "zod";

export interface OsvPackageQuery {
    ecosystem: string;
    name: string;
    version: string;
}

/** `failed` means "could not determine" and must never be read as "no vulnerabilities". */
export type PackageLookup =
    | { status: "ok"; vulnIds: string[] }
    | { status: "failed"; error: string };

export type VulnerabilityFetch =
    | { status: "ok"; vulnerability: NormalizedVulnerability }
    | { status: "failed"; error: string };

export interface OsvRange {
    type: string;
    events: Array<Record<string, string>>;
}

export interface AffectedPackage {
    ecosystem: string;
    name: string;
    /** Every `fixed` event across this entry's SEMVER/ECOSYSTEM ranges (not semver-sorted). */
    fixedVersions: string[];
    ranges: OsvRange[];
}

export interface NormalizedVulnerability {
    id: string;
    aliases: string[];
    summary: string | null;
    details: string | null;
    published: string | null;
    modified: string | null;
    withdrawn: string | null;
    /** Only the upstream label (database_specific.severity); no score is computed here. */
    severityLabel: string | null;
    /** Raw OSV `severity` array as JSON (CVSS vectors), or null when absent. */
    severityJson: string | null;
    references: string[];
    affected: AffectedPackage[];
    sourceUrl: string;
}

const vulnId = z.string().min(1).max(200);

export const osvBatchResponseSchema = z.object({
    results: z.array(
        z.object({
            vulns: z.array(z.object({ id: vulnId, modified: z.string().optional() })).optional(),
            next_page_token: z.string().optional(),
        }),
    ),
});

export const osvVulnerabilitySchema = z.object({
    id: vulnId,
    modified: z.string().optional(),
    published: z.string().optional(),
    withdrawn: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    summary: z.string().optional(),
    details: z.string().optional(),
    severity: z.array(z.object({ type: z.string(), score: z.string() })).optional(),
    affected: z
        .array(
            z.object({
                package: z.object({ ecosystem: z.string(), name: z.string() }).optional(),
                ranges: z
                    .array(z.object({ type: z.string(), events: z.array(z.record(z.string(), z.string())) }))
                    .optional(),
            }),
        )
        .optional(),
    references: z.array(z.object({ url: z.string() })).optional(),
    database_specific: z.record(z.string(), z.unknown()).optional(),
});

export type OsvVulnerabilityRecord = z.infer<typeof osvVulnerabilitySchema>;

const SEVERITY_LABELS = new Set(["LOW", "MODERATE", "MEDIUM", "HIGH", "CRITICAL"]);
const MAX_REFERENCES = 50;

export function normalizeVulnerability(raw: OsvVulnerabilityRecord): NormalizedVulnerability {
    const label = raw.database_specific?.["severity"];
    const affected: AffectedPackage[] = [];
    for (const entry of raw.affected ?? []) {
        if (!entry.package) continue;
        // GIT ranges carry commit hashes, not package versions.
        const ranges = (entry.ranges ?? []).filter((r) => r.type === "SEMVER" || r.type === "ECOSYSTEM");
        const fixed = new Set<string>();
        for (const range of ranges) {
            for (const event of range.events) {
                const f = event["fixed"];
                if (typeof f === "string") fixed.add(f);
            }
        }
        affected.push({
            ecosystem: entry.package.ecosystem,
            name: entry.package.name,
            fixedVersions: [...fixed].sort(),
            ranges: ranges.map((r) => ({ type: r.type, events: r.events })),
        });
    }
    return {
        id: raw.id,
        aliases: raw.aliases ?? [],
        summary: raw.summary ?? null,
        details: raw.details ?? null,
        published: raw.published ?? null,
        modified: raw.modified ?? null,
        withdrawn: raw.withdrawn ?? null,
        severityLabel:
            typeof label === "string" && SEVERITY_LABELS.has(label.toUpperCase()) ? label.toUpperCase() : null,
        severityJson: raw.severity && raw.severity.length > 0 ? JSON.stringify(raw.severity) : null,
        references: (raw.references ?? []).map((r) => r.url).slice(0, MAX_REFERENCES),
        affected,
        sourceUrl: `https://osv.dev/vulnerability/${encodeURIComponent(raw.id)}`,
    };
}