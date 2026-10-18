import { describe, expect, it } from "vitest";
import {
    compareVersions,
    isMajorBump,
    isValidVersion,
    isVersionAffected,
    satisfiesRange,
} from "../../src/modules/remediation/versioning.js";

const semverRange = (...events: Array<Record<string, string>>) => [{ type: "SEMVER", events }];

describe("isVersionAffected", () => {
    const range = semverRange({ introduced: "0" }, { fixed: "4.17.21" });

    it("treats versions below the fix as affected and the fix itself as clean", () => {
        expect(isVersionAffected("4.17.15", range)).toBe(true);
        expect(isVersionAffected("4.17.20", range)).toBe(true);
        expect(isVersionAffected("4.17.21", range)).toBe(false);
        expect(isVersionAffected("5.0.0", range)).toBe(false);
    });

    it("honors a later introduced version", () => {
        const r = semverRange({ introduced: "2.0.0" }, { fixed: "2.3.0" });
        expect(isVersionAffected("1.9.9", r)).toBe(false);
        expect(isVersionAffected("2.0.0", r)).toBe(true);
        expect(isVersionAffected("2.2.9", r)).toBe(true);
        expect(isVersionAffected("2.3.0", r)).toBe(false);
    });

    it("handles several introduced/fixed windows in one range", () => {
        const r = semverRange({ introduced: "0" }, { fixed: "1.2.0" }, { introduced: "2.0.0" }, { fixed: "2.1.0" });
        expect(isVersionAffected("1.1.0", r)).toBe(true);
        expect(isVersionAffected("1.5.0", r)).toBe(false);
        expect(isVersionAffected("2.0.5", r)).toBe(true);
        expect(isVersionAffected("2.1.0", r)).toBe(false);
    });

    it("handles last_affected as inclusive and ignores unfixed open ranges correctly", () => {
        const last = semverRange({ introduced: "0" }, { last_affected: "3.0.0" });
        expect(isVersionAffected("3.0.0", last)).toBe(true);
        expect(isVersionAffected("3.0.1", last)).toBe(false);
        const open = semverRange({ introduced: "1.0.0" });
        expect(isVersionAffected("9.9.9", open)).toBe(true);
    });

    it("is affected if any range says so", () => {
        const rs = [
            { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.0.0" }] },
            { type: "ECOSYSTEM", events: [{ introduced: "3.0.0" }, { fixed: "3.5.0" }] },
        ];
        expect(isVersionAffected("3.2.0", rs)).toBe(true);
        expect(isVersionAffected("2.0.0", rs)).toBe(false);
    });

    it("returns null (undecidable) rather than guessing", () => {
        expect(isVersionAffected("not-a-version", range)).toBeNull();
        expect(isVersionAffected("1.0.0", [{ type: "GIT", events: [{ introduced: "0" }, { fixed: "abc123" }] }])).toBeNull();
        expect(isVersionAffected("1.0.0", [])).toBeNull();
        expect(isVersionAffected("1.0.0", semverRange({ introduced: "0" }, { fixed: "garbage" }))).toBeNull();
    });
});

describe("version helpers", () => {
    it("compares, validates and detects major bumps", () => {
        expect(compareVersions("1.2.3", "1.10.0")).toBeLessThan(0);
        expect(isValidVersion("1.2.3")).toBe(true);
        expect(isValidVersion("abc")).toBe(false);
        expect(isMajorBump("4.17.15", "4.18.0")).toBe(false);
        expect(isMajorBump("4.17.15", "5.0.0")).toBe(true);
    });

    it("checks declared ranges and returns null for non-semver specifiers", () => {
        expect(satisfiesRange("1.2.0", "^1.0.0")).toBe(true);
        expect(satisfiesRange("2.0.0", "^1.0.0")).toBe(false);
        expect(satisfiesRange("1.2.0", "*")).toBe(true);
        expect(satisfiesRange("1.2.0", "file:../local")).toBeNull();
        expect(satisfiesRange("1.2.0", "git+https://example.test/x.git")).toBeNull();
    });
});