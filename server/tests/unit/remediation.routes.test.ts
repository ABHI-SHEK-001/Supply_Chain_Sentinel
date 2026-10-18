import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createRemediationRouter } from "../../src/modules/remediation/remediation.routes.js";
import { notFound } from "../../src/shared/errors/app-error.js";
import { errorHandler } from "../../src/shared/errors/error-handler.js";

function setup() {
    const service = {
        generatePlan: vi.fn().mockResolvedValue({ id: "plan_0123456789abcdef" }),
        listPlans: vi.fn().mockResolvedValue([]),
        getPlan: vi.fn().mockResolvedValue({ id: "plan_0123456789abcdef" }),
        validatePlan: vi.fn().mockResolvedValue({ status: "valid" }),
    };
    const app = express();
    app.use(express.json());
    app.use("/api/v1/remediation-plans", createRemediationRouter(service as never));
    app.use(errorHandler);
    return { app, service };
}
const PLAN = "plan_0123456789abcdef";

describe("remediation routes", () => {
    it("POST creates a plan (201) and normalizes the repository slug", async () => {
        const { app, service } = setup();
        const res = await request(app).post("/api/v1/remediation-plans").send({ repositoryId: " Demo ", vulnerabilityIds: ["GHSA-abcd-1234-wxyz"] });
        expect(res.status).toBe(201);
        expect(service.generatePlan).toHaveBeenCalledWith({ repositoryId: "demo", vulnerabilityIds: ["GHSA-abcd-1234-wxyz"] });
    });

    it.each([
        ["missing repository", {}],
        ["path traversal repository", { repositoryId: "../x" }],
        ["empty vulnerability list", { repositoryId: "demo", vulnerabilityIds: [] }],
        ["bad vulnerability id", { repositoryId: "demo", vulnerabilityIds: ["../etc"] }],
        ["too many ids", { repositoryId: "demo", vulnerabilityIds: Array.from({ length: 201 }, (_, i) => `V-${i}`) }],
    ])("POST rejects %s with 400 and never calls the service", async (_l, body) => {
        const { app, service } = setup();
        const res = await request(app).post("/api/v1/remediation-plans").send(body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
        expect(service.generatePlan).not.toHaveBeenCalled();
    });

    it("GET / filters by repository and validates it", async () => {
        const { app, service } = setup();
        await request(app).get("/api/v1/remediation-plans?repositoryId=Demo");
        expect(service.listPlans).toHaveBeenCalledWith("demo");
        expect((await request(app).get("/api/v1/remediation-plans?repositoryId=BAD!")).status).toBe(400);
    });

    it("GET /:planId and POST /:planId/validate validate the id and map 404", async () => {
        const { app, service } = setup();
        expect((await request(app).get(`/api/v1/remediation-plans/${PLAN}`)).status).toBe(200);
        expect((await request(app).post(`/api/v1/remediation-plans/${PLAN}/validate`)).status).toBe(200);
        expect((await request(app).get("/api/v1/remediation-plans/not-a-plan")).status).toBe(400);
        expect((await request(app).post("/api/v1/remediation-plans/plan_XYZ/validate")).status).toBe(400);
        service.getPlan.mockRejectedValue(notFound("nope"));
        expect((await request(app).get(`/api/v1/remediation-plans/${PLAN}`)).status).toBe(404);
    });
});