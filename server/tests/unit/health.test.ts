import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { parseEnv } from "../../src/config/env.js";

const env = parseEnv({});

describe("health endpoints", () => {
    it("GET /health returns liveness without touching the graph", async () => {
        const res = await request(createApp({ env })).get("/health");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe("ok");
        expect(res.body.data.graph).toBeUndefined();
    });

    it("GET /api/v1/health reports graph as not_configured when no probe exists", async () => {
        const res = await request(createApp({ env })).get("/api/v1/health");
        expect(res.status).toBe(200);
        expect(res.body.data.api.status).toBe("up");
        expect(res.body.data.graph.status).toBe("not_configured");
    });

    it("reports graph up when the probe succeeds", async () => {
        const app = createApp({ env, graphHealth: async () => { } });
        const res = await request(app).get("/api/v1/health");
        expect(res.status).toBe(200);
        expect(res.body.data.graph.status).toBe("up");
    });

    it("returns 503 degraded when the probe fails, while liveness stays 200", async () => {
        const app = createApp({
            env,
            graphHealth: async () => {
                throw new Error("connect ECONNREFUSED");
            },
        });
        const ready = await request(app).get("/api/v1/health");
        expect(ready.status).toBe(503);
        expect(ready.body.success).toBe(false);
        expect(ready.body.data.status).toBe("degraded");
        expect(ready.body.data.api.status).toBe("up");
        expect(ready.body.data.graph.status).toBe("down");
        expect(JSON.stringify(ready.body)).not.toContain("ECONNREFUSED");

        const live = await request(app).get("/health");
        expect(live.status).toBe(200);
    });
});