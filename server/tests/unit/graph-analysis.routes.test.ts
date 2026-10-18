import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createGraphAnalysisRouter } from "../../src/modules/graph-analysis/graph-analysis.routes.js";
import { createVulnerabilityRouter } from "../../src/modules/vulnerabilities/vulnerability.routes.js";
import { notFound } from "../../src/shared/errors/app-error.js";
import { errorHandler } from "../../src/shared/errors/error-handler.js";

function setup() {
    const service = {
        getGraph: vi.fn().mockResolvedValue({ nodes: [] }),
        analyzeRepository: vi.fn().mockResolvedValue({ findings: [] }),
        listVulnerabilities: vi.fn().mockResolvedValue({ total: 0, items: [] }),
        getVulnerability: vi.fn().mockResolvedValue({ vulnerability: {}, repositories: [] }),
    };
    const app = express();
    app.use("/api/v1/repositories", createGraphAnalysisRouter(service as never));
    app.use("/api/v1/vulnerabilities", createVulnerabilityRouter(service as never));
    app.use(errorHandler);
    return { app, service };
}

describe("graph analysis routes", () => {
    it("GET /repositories/:id/graph passes slug and limit", async () => {
        const { app, service } = setup();
        const res = await request(app).get("/api/v1/repositories/Demo/graph?limit=50");
        expect(res.status).toBe(200);
        expect(service.getGraph).toHaveBeenCalledWith("demo", 50);
    });

    it("GET /repositories/:id/vulnerabilities applies defaults and optional filters", async () => {
        const { app, service } = setup();
        await request(app).get("/api/v1/repositories/demo/vulnerabilities");
        expect(service.analyzeRepository).toHaveBeenLastCalledWith("demo", { maxDepth: 30, maxPathsPerFinding: 10 });
        await request(app).get("/api/v1/repositories/demo/vulnerabilities?maxDepth=5&maxPaths=3&vulnerabilityId=GHSA-abcd-1234-wxyz");
        expect(service.analyzeRepository).toHaveBeenLastCalledWith("demo", {
            maxDepth: 5, maxPathsPerFinding: 3, vulnerabilityId: "GHSA-abcd-1234-wxyz",
        });
    });

    it.each([
        ["/api/v1/repositories/demo/vulnerabilities?maxDepth=0"],
        ["/api/v1/repositories/demo/vulnerabilities?maxDepth=999"],
        ["/api/v1/repositories/demo/vulnerabilities?maxPaths=abc"],
        ["/api/v1/repositories/demo/vulnerabilities?vulnerabilityId=../x"],
        ["/api/v1/repositories/demo/graph?limit=0"],
        ["/api/v1/repositories/BAD%20ID!/graph"],
        ["/api/v1/vulnerabilities?limit=9999"],
        ["/api/v1/vulnerabilities/bad%20id"],
    ])("rejects invalid input %s with 400", async (url) => {
        const { app, service } = setup();
        const res = await request(app).get(url);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
        expect(service.getGraph).not.toHaveBeenCalled();
        expect(service.analyzeRepository).not.toHaveBeenCalled();
    });

    it("GET /vulnerabilities and /vulnerabilities/:id delegate and map 404", async () => {
        const { app, service } = setup();
        expect((await request(app).get("/api/v1/vulnerabilities?limit=5")).status).toBe(200);
        expect(service.listVulnerabilities).toHaveBeenCalledWith(5);
        service.getVulnerability.mockRejectedValue(notFound("nope"));
        const res = await request(app).get("/api/v1/vulnerabilities/GHSA-abcd-1234-wxyz");
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("NOT_FOUND");
    });
});