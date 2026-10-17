import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createRepositoryRouter } from "../../src/modules/repositories/repository.routes.js";
import { AppError, notFound } from "../../src/shared/errors/app-error.js";
import { errorHandler } from "../../src/shared/errors/error-handler.js";

function setup() {
    const service = { list: vi.fn(), get: vi.fn(), register: vi.fn() };
    const app = express();
    app.use(express.json());
    app.use("/api/v1/repositories", createRepositoryRouter(service as never));
    app.use(errorHandler);
    return { app, service };
}

const lockfile = '{"lockfileVersion":3,"packages":{"":{}}}';

describe("repository routes", () => {
    it("POST creates a repository (201) with a normalized name", async () => {
        const { app, service } = setup();
        service.register.mockResolvedValue({ repository: { id: "acme-web" }, ingestion: {} });
        const res = await request(app)
            .post("/api/v1/repositories")
            .send({ name: "  Acme-Web ", lockfile });
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(service.register).toHaveBeenCalledWith({ name: "acme-web", ecosystem: "npm", lockfile });
    });

    it.each([
        ["path traversal name", { name: "../etc", lockfile }],
        ["empty name", { name: "", lockfile }],
        ["missing lockfile", { name: "ok" }],
        ["unsupported ecosystem", { name: "ok", ecosystem: "pypi", lockfile }],
    ])("POST rejects %s with 400 and never calls the service", async (_label, body) => {
        const { app, service } = setup();
        const res = await request(app).post("/api/v1/repositories").send(body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
        expect(service.register).not.toHaveBeenCalled();
    });

    it("POST surfaces service errors with their status and code", async () => {
        const { app, service } = setup();
        service.register.mockRejectedValue(new AppError(422, "UNSUPPORTED_LOCKFILE", "nope"));
        const res = await request(app).post("/api/v1/repositories").send({ name: "ok", lockfile });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("UNSUPPORTED_LOCKFILE");
    });

    it("GET / lists repositories", async () => {
        const { app, service } = setup();
        service.list.mockResolvedValue([{ id: "acme-web" }]);
        const res = await request(app).get("/api/v1/repositories");
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([{ id: "acme-web" }]);
    });

    it("GET /:id returns 404 for unknown and 400 for an invalid id", async () => {
        const { app, service } = setup();
        service.get.mockRejectedValue(notFound('Repository "ghost" not found'));
        expect((await request(app).get("/api/v1/repositories/ghost")).status).toBe(404);
        expect((await request(app).get("/api/v1/repositories/BAD%20ID!")).status).toBe(400);
    });
});