import { describe, expect, it } from "vitest";
import { OsvClient } from "../../src/modules/vulnerabilities/osv.client.js";

const live = process.env["OSV_LIVE"] === "1";

describe.skipIf(!live)("OSV live API", () => {
    const client = new OsvClient({ timeoutMs: 20000, concurrency: 2 });

    it(
        "returns findings for a known-vulnerable version and a valid full record",
        async () => {
            const [res] = await client.queryPackages([{ ecosystem: "npm", name: "lodash", version: "4.17.15" }]);
            expect(res?.status).toBe("ok");
            if (res?.status !== "ok") return;
            expect(res.vulnIds.length).toBeGreaterThan(0);
            const record = await client.getVulnerability(res.vulnIds[0] as string);
            expect(record.id).toBe(res.vulnIds[0]);
            expect(record.affected.length).toBeGreaterThan(0);
        },
        60000,
    );

    it(
        "confirms an unknown package as ok with no vulnerabilities",
        async () => {
            const [res] = await client.queryPackages([
                { ecosystem: "npm", name: "zzz-sentinel-nonexistent-package-xyz", version: "1.0.0" },
            ]);
            expect(res).toEqual({ status: "ok", vulnIds: [] });
        },
        60000,
    );
});