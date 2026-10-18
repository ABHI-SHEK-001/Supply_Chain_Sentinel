import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createMemoryRouter } from "../../src/modules/memory/memory.routes.js";
import { notFound } from "../../src/shared/errors/app-error.js";
import { errorHandler } from "../../src/shared/errors/error-handler.js";

function setup() {
  const service = {
    recordDecision: vi.fn().mockResolvedValue({ id: "dec_0123456789abcdef" }),
    search: vi.fn().mockResolvedValue([]),
    revoke: vi.fn().mockResolvedValue({ id: "dec_0123456789abcdef", status: "revoked" }),
  };
  const app = express();
  app.use(express.json());
  app.use("/api/v1/memory", createMemoryRouter(service as never));
  app.use(errorHandler);
  return { app, service };
}
const ID = "dec_0123456789abcdef";
const valid = { repositoryId: " Demo ", type: "accepted_risk", vulnerabilityId: "GHSA-abcd", packageVersionId: "npm:lodash@4.17.15", explanation: "  why  ", actor: "alice" };

describe("memory routes", () => {
  it("POST records (201), trimming and normalizing input", async () => {
    const { app, service } = setup();
    const res = await request(app).post("/api/v1/memory").send(valid);
    expect(res.status).toBe(201);
    expect(service.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: "demo", explanation: "why" }));
  });

  it.each([
    ["unknown type", { ...valid, type: "ignore_forever" }],
    ["empty explanation", { ...valid, explanation: "  " }],
    ["missing actor", { ...valid, actor: undefined }],
    ["bad package id", { ...valid, packageVersionId: "../../x" }],
    ["bad plan id", { ...valid, planId: "nope" }],
    ["non-date validUntil", { ...valid, validUntil: "tomorrow" }],
  ])("POST rejects %s with 400", async (_l, body) => {
    const { app, service } = setup();
    expect((await request(app).post("/api/v1/memory").send(body)).status).toBe(400);
    expect(service.recordDecision).not.toHaveBeenCalled();
  });

  it("GET requires a repository, validates filters and caps the limit", async () => {
    const { app, service } = setup();
    expect((await request(app).get("/api/v1/memory")).status).toBe(400);
    expect((await request(app).get("/api/v1/memory?repositoryId=demo&status=bogus")).status).toBe(400);
    expect((await request(app).get("/api/v1/memory?repositoryId=demo&limit=999")).status).toBe(400);
    expect((await request(app).get("/api/v1/memory?repositoryId=Demo&type=note&q=key")).status).toBe(200);
    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: "demo", type: "note", q: "key", limit: 50 }));
  });

  it("POST /:id/revoke validates ids and maps 404", async () => {
    const { app, service } = setup();
    expect((await request(app).post(`/api/v1/memory/${ID}/revoke`).send({ repositoryId: "demo", reason: "wrong" })).status).toBe(200);
    expect(service.revoke).toHaveBeenCalledWith("demo", ID, "wrong");
    expect((await request(app).post("/api/v1/memory/bad/revoke").send({ repositoryId: "demo" })).status).toBe(400);
    expect((await request(app).post(`/api/v1/memory/${ID}/revoke`).send({})).status).toBe(400);
    service.revoke.mockRejectedValue(notFound("nope"));
    expect((await request(app).post(`/api/v1/memory/${ID}/revoke`).send({ repositoryId: "demo" })).status).toBe(404);
  });
});
