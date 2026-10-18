import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpServer, type McpDeps } from "../../src/mcp/mcp-server.js";
import { createMcpRouter } from "../../src/mcp/mcp.routes.js";
import { AppError, notFound } from "../../src/shared/errors/app-error.js";

const PLAN = "plan_0123456789abcdef";

function deps() {
  const d = {
    orchestrator: {
      start: vi.fn().mockResolvedValue({ id: "pipe_0123456789abcdef", status: "running" }),
      getPipeline: vi.fn().mockResolvedValue({ id: "pipe_0123456789abcdef" }),
      listPipelines: vi.fn().mockResolvedValue([]),
      getTask: vi.fn(),
    },
    triage: { triage: vi.fn().mockResolvedValue({ summary: { actionable: 1 } }) },
    remediation: {
      generatePlan: vi.fn().mockResolvedValue({ id: PLAN }),
      validatePlan: vi.fn().mockResolvedValue({ status: "valid" }),
      getPlan: vi.fn().mockResolvedValue({ id: PLAN }),
      listPlans: vi.fn().mockResolvedValue([]),
    },
    memory: {
      recordDecision: vi.fn().mockResolvedValue({ id: "dec_0123456789abcdef" }),
      search: vi.fn().mockResolvedValue([]),
      revoke: vi.fn().mockResolvedValue({ status: "revoked" }),
    },
  };
  return d;
}

const clients: Client[] = [];
async function connect(d: ReturnType<typeof deps>) {
  const server = createMcpServer(d as unknown as McpDeps);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(ct);
  clients.push(client);
  return client;
}
afterEach(async () => { await Promise.all(clients.splice(0).map((c) => c.close())); });

const text = (r: unknown): string => ((r as { content: Array<{ text: string }> }).content[0] as { text: string }).text;

describe("MCP tools", () => {
  it("exposes the expected tools, with read-only hints on the read tools", async () => {
    const client = await connect(deps());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "analyze_repository", "create_remediation_plan", "get_pipeline", "get_remediation_plan", "list_pipelines",
      "list_remediation_plans", "record_decision", "revoke_decision", "search_decisions", "triage_findings", "validate_remediation_plan",
    ]);
    const hint = (n: string) => tools.find((t) => t.name === n)!.annotations?.readOnlyHint;
    expect(["get_pipeline", "get_remediation_plan", "list_pipelines", "list_remediation_plans", "search_decisions"].every((n) => hint(n) === true)).toBe(true);
    expect(["analyze_repository", "record_decision", "create_remediation_plan", "revoke_decision"].every((n) => hint(n) === false)).toBe(true);
    expect(tools.every((t) => (t.description ?? "").length > 40)).toBe(true);
  });

  it("wraps the services: input is normalized the same way as the REST API and output is JSON text", async () => {
    const d = deps();
    const client = await connect(d);
    const r = await client.callTool({ name: "analyze_repository", arguments: { repositoryId: " Demo " } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(text(r))).toMatchObject({ id: "pipe_0123456789abcdef", status: "running" });
    expect(d.orchestrator.start).toHaveBeenCalledWith("demo");

    await client.callTool({ name: "create_remediation_plan", arguments: { repositoryId: "demo", vulnerabilityIds: ["GHSA-A"] } });
    expect(d.remediation.generatePlan).toHaveBeenCalledWith({ repositoryId: "demo", vulnerabilityIds: ["GHSA-A"] });
    await client.callTool({ name: "validate_remediation_plan", arguments: { planId: PLAN } });
    expect(d.remediation.validatePlan).toHaveBeenCalledWith(PLAN);
    await client.callTool({ name: "triage_findings", arguments: { repositoryId: "demo" } });
    expect(d.triage.triage).toHaveBeenCalledWith("demo");
    await client.callTool({ name: "search_decisions", arguments: { repositoryId: "demo", type: "note", q: "key" } });
    expect(d.memory.search).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: "demo", type: "note", q: "key", limit: 50 }));
    await client.callTool({ name: "revoke_decision", arguments: { repositoryId: "demo", decisionId: "dec_0123456789abcdef", reason: "wrong" } });
    expect(d.memory.revoke).toHaveBeenCalledWith("demo", "dec_0123456789abcdef", "wrong");
  });

  it("records decisions with the same validation as the REST route", async () => {
    const d = deps();
    const client = await connect(d);
    const args = { repositoryId: "demo", type: "accepted_risk", vulnerabilityId: "GHSA-A", packageVersionId: "npm:a@1.0.0", explanation: "not reachable", actor: "agent:claude" };
    const ok = await client.callTool({ name: "record_decision", arguments: args });
    expect(ok.isError).toBeFalsy();
    expect(d.memory.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ type: "accepted_risk", actor: "agent:claude" }));
    d.memory.recordDecision.mockClear();
    const bad = await client.callTool({ name: "record_decision", arguments: { ...args, type: "ignore_forever" } }).catch((e: unknown) => e);
    expect(bad instanceof Error || (bad as { isError?: boolean }).isError === true).toBe(true);
    expect(d.memory.recordDecision).not.toHaveBeenCalled();
  });

  it("rejects malformed ids before reaching the service", async () => {
    const d = deps();
    const client = await connect(d);
    const bad = await client.callTool({ name: "get_remediation_plan", arguments: { planId: "../../etc/passwd" } }).catch((e: unknown) => e);
    expect(bad instanceof Error || (bad as { isError?: boolean }).isError === true).toBe(true);
    expect(d.remediation.getPlan).not.toHaveBeenCalled();
  });

  it("reports expected errors with their code, and hides unexpected ones", async () => {
    const d = deps();
    const client = await connect(d);
    d.orchestrator.start.mockRejectedValueOnce(new AppError(409, "PIPELINE_ALREADY_RUNNING", "busy"));
    const busy = await client.callTool({ name: "analyze_repository", arguments: { repositoryId: "demo" } });
    expect(busy.isError).toBe(true);
    expect(text(busy)).toBe("PIPELINE_ALREADY_RUNNING: busy");

    d.remediation.getPlan.mockRejectedValueOnce(notFound("no such plan"));
    expect(text(await client.callTool({ name: "get_remediation_plan", arguments: { planId: PLAN } }))).toBe("NOT_FOUND: no such plan");

    d.triage.triage.mockRejectedValueOnce(new Error("FalkorDB at 10.0.0.5:6379 refused connection"));
    const boom = await client.callTool({ name: "triage_findings", arguments: { repositoryId: "demo" } });
    expect(boom.isError).toBe(true);
    expect(text(boom)).not.toContain("10.0.0.5");
    expect(text(boom)).toContain("Internal error");
  });
});

describe("MCP over HTTP", () => {
  function app() {
    const a = express();
    a.use(express.json());
    a.use("/mcp", createMcpRouter(deps() as unknown as McpDeps));
    return a;
  }
  const headers = { Accept: "application/json, text/event-stream", "Content-Type": "application/json" };

  it("answers initialize and tools/list statelessly", async () => {
    const a = app();
    const init = await request(a).post("/mcp").set(headers).send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    expect(init.status).toBe(200);
    expect(init.text).toContain("supplychain-sentinel");
    expect(init.headers["mcp-session-id"]).toBeUndefined();

    const list = await request(a).post("/mcp").set(headers).send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(list.status).toBe(200);
    expect(list.text).toContain("analyze_repository");
    expect(list.text).toContain("record_decision");
  });

  it("rejects GET and DELETE with 405", async () => {
    const a = app();
    expect((await request(a).get("/mcp")).status).toBe(405);
    expect((await request(a).delete("/mcp")).status).toBe(405);
  });
});
