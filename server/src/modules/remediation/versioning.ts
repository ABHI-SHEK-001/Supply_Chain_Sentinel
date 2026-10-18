import semver from "semver";

export interface RangeSpec {
    type: string;
    events: Array<Record<string, string>>;
}

const EVENT_KINDS = ["introduced", "fixed", "last_affected", "limit"] as const;
type EventKind = (typeof EVENT_KINDS)[number];
const EVENT_ORDER: Record<EventKind, number> = { introduced: 0, last_affected: 1, fixed: 2, limit: 2 };

const isEventKind = (k: string): k is EventKind => (EVENT_KINDS as readonly string[]).includes(k);

export const isValidVersion = (v: string): boolean => semver.valid(v) !== null;

export function compareVersions(a: string, b: string): number {
    return semver.compare(a, b);
}

export function isMajorBump(from: string, to: string): boolean {
    return semver.major(to) > semver.major(from);
}

/** null when the range is not a semver range (git URLs, file: paths, tags like "latest"). */
export function satisfiesRange(version: string, range: string): boolean | null {
    if (semver.validRange(range) === null || semver.valid(version) === null) return null;
    return semver.satisfies(version, range);
}

/**
 * Evaluates OSV SEMVER/ECOSYSTEM ranges for a version.
 * Returns true/false, or null when it cannot be decided (no usable range, invalid versions).
 */
export function isVersionAffected(version: string, ranges: readonly RangeSpec[]): boolean | null {
    const v = semver.valid(version);
    if (v === null) return null;
    const usable = ranges.filter((r) => r.type === "SEMVER" || r.type === "ECOSYSTEM");
    if (usable.length === 0) return null;

    for (const range of usable) {
        const events: Array<{ kind: EventKind; value: string }> = [];
        for (const e of range.events) {
            for (const [kind, value] of Object.entries(e)) {
                if (!isEventKind(kind)) continue;
                if (value !== "0" && semver.valid(value) === null) return null;
                events.push({ kind, value });
            }
        }
        const cmp = (a: string, b: string): number =>
            a === b ? 0 : a === "0" ? -1 : b === "0" ? 1 : semver.compare(a, b);
        events.sort((a, b) => cmp(a.value, b.value) || EVENT_ORDER[a.kind] - EVENT_ORDER[b.kind]);

        let affected = false;
        for (const e of events) {
            if (e.kind === "introduced") {
                if (e.value === "0" || semver.compare(v, e.value) >= 0) affected = true;
            } else if (e.kind === "fixed" || e.kind === "limit") {
                if (semver.compare(v, e.value) >= 0) affected = false;
            } else if (semver.compare(v, e.value) > 0) {
                affected = false; // last_affected
            }
        }
        if (affected) return true;
    }
    return false;
}