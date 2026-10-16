import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { parseEnv } from "../../src/config/env.js";

const app = createApp({ env: parseEnv({}) });

describe("error handling", () => {
    it("returns a 404 envelope for unknown routes", async () => {
        const res = await request(app).get("/api/v1/nope");
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    });

    it("returns a 400 envelope for malformed JSON", async () => {
        const res = await request(app)
            .post("/api/v1/health")
            .set("Content-Type", "application/json")
            .send("{ not json");
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_JSON");
    });
});