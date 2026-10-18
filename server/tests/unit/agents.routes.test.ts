import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createAgentsRouter } from "../../src/modules/agents/agents.routes.js";
import { AppError, notFound } from "../../src/shared/errors/app-error.js";
import { errorHandler } from "../../src/shared/errors/error-handler.js";

function setup() {
  const orchestrator = {
    start: vi.fn().mockResolvedValue({ id: "pipe_0123456789abcdef", status: "running" }),
    getPipeline: vi.fn().mockResolvedValue({ id: "pipe_0123456789abcdef" }),
    getTask: vi.fn().mockResolvedValue({ id: "task_0123456789abcdef" }),
    listPipelines: vi.fn().mockResolvedValue([]),
  };
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createAgentsRouter(orchestrator as never));
  app.use(errorHandler);
  return { app, orchestrator };
}

describe("agents routes", () => {
  it("POST /repositories/:id/analyze returns 202 and normalizes the slug", async () => {
    const { app, orchestrator } = setup();
    const res = await request(app).post("/api/v1/repositories/Demo/analyze");
    expect(res.status).toBe(202);
    expect(res.body.data.id).toBe("pipe_0123456789abcdef");
    expect(orchestrator.start).toHaveBeenCalledWith("demo");
  });

  it("maps 404 and 409 from the orchestrator", async () => {
    const { app, orchestrator } = setup();
    orchestrator.start.mockRejectedValueOnce(notFound("no repo"));
    expect((await request(app).post("/api/v1/repositories/ghost/analyze")).status).toBe(404);
    orchestrator.start.mockRejectedValueOnce(new AppError(409, "PIPELINE_ALREADY_RUNNING", "busy"));
    const busy = await request(app).post("/api/v1/repositories/demo/analyze");
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe("PIPELINE_ALREADY_RUNNING");
  });

  it("rejects bad repository slugs and ids without calling the service", async () => {
    const { app, orchestrator } = setup();
    expect((await request(app).post("/api/v1/repositories/..%2Fx/analyze")).status).toBe(400);
    expect((await request(app).get("/api/v1/pipelines/nope")).status).toBe(400);
    expect((await request(app).get("/api/v1/tasks/pipe_0123456789abcdef")).status).toBe(400);
    expect(orchestrator.start).not.toHaveBeenCalled();
    expect(orchestrator.getPipeline).not.toHaveBeenCalled();
  });

  it("serves pipelines, tasks and per-repository history", async () => {
    const { app, orchestrator } = setup();
    expect((await request(app).get("/api/v1/pipelines/pipe_0123456789abcdef")).status).toBe(200);
    expect((await request(app).get("/api/v1/tasks/task_0123456789abcdef")).status).toBe(200);
    expect((await request(app).get("/api/v1/repositories/Demo/pipelines")).status).toBe(200);
    expect(orchestrator.listPipelines).toHaveBeenCalledWith("demo");
    orchestrator.getTask.mockRejectedValueOnce(notFound("nope"));
    expect((await request(app).get("/api/v1/tasks/task_0123456789abcdef")).status).toBe(404);
  });
});
