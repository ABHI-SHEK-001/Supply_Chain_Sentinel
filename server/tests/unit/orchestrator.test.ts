import { describe, expect, it, vi } from "vitest";
import { RemediationAgent, ScannerAgent, toJsonSafe, toRemediatorInput } from "../../src/modules/agents/agents.js";
import { AgentOrchestrator } from "../../src/modules/agents/orchestrator.js";
import type { AgentTask } from "../../src/modules/agents/task.types.js";
import type { TriageReport } from "../../src/modules/agents/triage.js";

const NOW = new Date("2026-10-18T12:00:00.000Z");

class FakeStore {
  tasks = new Map<string, AgentTask>();
  saves: Array<[string, string]> = [];
  exists = true;
  recovered = 0;
  repositoryExists = vi.fn(async () => this.exists);
  create = vi.fn(async (ts: readonly AgentTask[]) => { ts.forEach((t) => this.tasks.set(t.id, { ...t })); });
  save = vi.fn(async (t: AgentTask) => { this.tasks.set(t.id, { ...t }); this.saves.push([t.agent, t.status]); });
  loadPipeline = vi.fn(async (pid: string) => [...this.tasks.values()].filter((t) => t.pipelineId === pid).sort((a, b) => a.seq - b.seq));
  loadTask = vi.fn(async (id: string) => this.tasks.get(id) ?? null);
  listPipelineIds = vi.fn(async () => [...new Set([...this.tasks.values()].map((t) => t.pipelineId))]);
  recoverInterrupted = vi.fn(async () => this.recovered);
}

const report = (ids: string[], suppressed = 0): TriageReport => ({
  repositoryId: "demo", generatedAt: NOW.toISOString(),
  summary: { totalFindings: ids.length + suppressed, actionable: ids.length, suppressed, byPriority: { P1: 0, P2: 0, P3: 0 } },
  actionable: ids.map((id) => ({ vulnerabilityId: id, packageVersionId: "npm:a@1.0.0", name: "a", version: "1.0.0", severityLabel: "HIGH", direct: true, fixAvailable: true, advisoriesOnPackage: 1, score: 45, priority: "P1" as const, evidence: [], reviewNote: null })),
  suppressed: [], memoryTransitions: [], notes: [],
});

function setup(over: { scanner?: () => Promise<unknown>; triager?: () => Promise<unknown>; remediator?: () => Promise<unknown> } = {}) {
  const store = new FakeStore();
  const agents = {
    scanner: { run: vi.fn(over.scanner ?? (async () => ({ repositoryId: "demo", scan: { vulnerabilities: 4 } }))) },
    triager: { run: vi.fn(over.triager ?? (async () => ({ repositoryId: "demo", report: report(["GHSA-B", "GHSA-A", "GHSA-A"]) }))) },
    remediator: { run: vi.fn(over.remediator ?? (async () => ({ repositoryId: "demo", planId: "plan_0000000000000001", upgradeCount: 2 }))) },
  };
  const errors: unknown[] = [];
  let n = 0;
  const orchestrator = new AgentOrchestrator(store as never, agents as never, {
    clock: () => NOW, newPipelineSuffix: () => `s${n++}`, onError: (e) => errors.push(e),
  });
  return { store, agents, orchestrator, errors };
}

const statuses = (s: { tasks: AgentTask[] }) => s.tasks.map((t) => `${t.agent}:${t.status}`);

describe("AgentOrchestrator", () => {
  it("returns a queued snapshot immediately, then runs all three agents in order", async () => {
    const { orchestrator, agents, store } = setup();
    const started = await orchestrator.start("demo");
    expect(started.status).toBe("running");
    expect(statuses(started)).toEqual(["scanner:queued", "triager:queued", "remediator:queued"]);
    expect(started.id).toMatch(/^pipe_[a-f0-9]{16}$/);
    expect(started.tasks.every((t) => /^task_[a-f0-9]{16}$/.test(t.id))).toBe(true);
    expect(started.tasks.map((t) => t.handedOffTo)).toEqual([started.tasks[1]!.id, started.tasks[2]!.id, null]);

    await orchestrator.waitForIdle();
    const done = await orchestrator.getPipeline(started.id);
    expect(done.status).toBe("succeeded");
    expect(statuses(done)).toEqual(["scanner:succeeded", "triager:succeeded", "remediator:succeeded"]);

    // strictly sequential: queued->running->succeeded for each agent, one agent at a time
    expect(store.saves.filter(([, s]) => s !== "queued")).toEqual([
      ["scanner", "running"], ["scanner", "succeeded"], ["triager", "running"], ["triager", "succeeded"], ["remediator", "running"], ["remediator", "succeeded"],
    ]);
    expect(agents.scanner.run).toHaveBeenCalledTimes(1);
  });

  it("stores each agent's output as the next task's input", async () => {
    const { orchestrator, agents } = setup();
    const started = await orchestrator.start("demo");
    await orchestrator.waitForIdle();
    const done = await orchestrator.getPipeline(started.id);
    expect(done.tasks[0]!.input).toEqual({ repositoryId: "demo" });
    expect(done.tasks[1]!.input).toEqual(done.tasks[0]!.output);
    expect(agents.triager.run).toHaveBeenCalledWith({ repositoryId: "demo", scan: { vulnerabilities: 4 } });
    // remediator receives the distinct actionable advisory ids derived from triage
    expect(done.tasks[2]!.input).toEqual({ repositoryId: "demo", vulnerabilityIds: ["GHSA-A", "GHSA-B"], actionableFindings: 3, suppressedFindings: 0 });
    expect(done.tasks[2]!.startedAt).toBe(NOW.toISOString());
  });

  it("skips the remediator when triage leaves nothing actionable", async () => {
    const { orchestrator, agents } = setup({ triager: async () => ({ repositoryId: "demo", report: report([], 2) }) });
    const started = await orchestrator.start("demo");
    await orchestrator.waitForIdle();
    const done = await orchestrator.getPipeline(started.id);
    expect(done.status).toBe("succeeded");
    expect(statuses(done)).toEqual(["scanner:succeeded", "triager:succeeded", "remediator:skipped"]);
    expect(done.tasks[2]!.detail).toContain("nothing to remediate");
    expect(agents.remediator.run).not.toHaveBeenCalled();
  });

  it("fails the pipeline and skips downstream agents when one fails", async () => {
    const { orchestrator, agents } = setup({ triager: async () => { throw new Error("graph exploded"); } });
    const started = await orchestrator.start("demo");
    await orchestrator.waitForIdle();
    const done = await orchestrator.getPipeline(started.id);
    expect(done.status).toBe("failed");
    expect(statuses(done)).toEqual(["scanner:succeeded", "triager:failed", "remediator:skipped"]);
    expect(done.tasks[1]!.detail).toBe("graph exploded");
    expect(done.tasks[2]!.detail).toContain("earlier agent failed");
    expect(agents.remediator.run).not.toHaveBeenCalled();
  });

  it("allows only one pipeline per repository at a time, and releases the slot afterwards", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { orchestrator } = setup({ scanner: async () => { await gate; return { repositoryId: "demo", scan: null }; } });
    await orchestrator.start("demo");
    await expect(orchestrator.start("demo")).rejects.toMatchObject({ statusCode: 409, code: "PIPELINE_ALREADY_RUNNING" });
    release();
    await orchestrator.waitForIdle();
    const again = await orchestrator.start("demo");
    expect(again.status).toBe("running");
    await orchestrator.waitForIdle();
  });

  it("lets different repositories run side by side", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { orchestrator } = setup({ scanner: async () => { await gate; return { repositoryId: "x", scan: null }; } });
    await orchestrator.start("one");
    await expect(orchestrator.start("two")).resolves.toBeTruthy();
    release();
    await orchestrator.waitForIdle();
  });

  it("404s for an unknown repository and does not claim the slot when creation fails", async () => {
    const { orchestrator, store } = setup();
    store.exists = false;
    await expect(orchestrator.start("ghost")).rejects.toMatchObject({ statusCode: 404 });
    store.exists = true;
    store.create.mockRejectedValueOnce(new Error("db down"));
    await expect(orchestrator.start("demo")).rejects.toThrow("db down");
    await expect(orchestrator.start("demo")).resolves.toBeTruthy(); // slot was released
    await orchestrator.waitForIdle();
  });

  it("stops the pipeline, reports the error and skips later agents if persistence breaks mid-run", async () => {
    const { orchestrator, store, errors, agents } = setup();
    const real = store.save.getMockImplementation()!;
    store.save.mockImplementation(async (t: AgentTask) => {
      if (t.agent === "triager" && t.status === "succeeded") throw new Error("write failed");
      return real(t);
    });
    const started = await orchestrator.start("demo");
    await orchestrator.waitForIdle();
    const done = await orchestrator.getPipeline(started.id);
    expect(errors).toHaveLength(1);
    expect(done.tasks[2]!.status).toBe("skipped");
    expect(agents.remediator.run).not.toHaveBeenCalled();
    // the failed write leaves the stored triager task as "running"; recoverInterrupted() cleans that up on restart
    expect(done.tasks[1]!.status).toBe("running");
  });

  it("looks up tasks and pipelines, and lists summaries", async () => {
    const { orchestrator } = setup();
    const started = await orchestrator.start("demo");
    await orchestrator.waitForIdle();
    expect((await orchestrator.getTask(started.tasks[0]!.id)).agent).toBe("scanner");
    await expect(orchestrator.getTask("task_ffffffffffffffff")).rejects.toMatchObject({ statusCode: 404 });
    await expect(orchestrator.getPipeline("pipe_ffffffffffffffff")).rejects.toMatchObject({ statusCode: 404 });
    const list = await orchestrator.listPipelines("demo");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: started.id, status: "succeeded" });
    expect(list[0]!.tasks[0]).toEqual({ id: started.tasks[0]!.id, agent: "scanner", status: "succeeded", detail: null });
  });

  it("delegates crash recovery to the store", async () => {
    const { orchestrator, store } = setup();
    store.recovered = 3;
    expect(await orchestrator.recoverInterrupted()).toBe(3);
  });
});

describe("agents", () => {
  it("toJsonSafe never throws and bounds size", () => {
    expect(toJsonSafe(undefined)).toBeNull();
    expect(toJsonSafe({ a: 1, b: undefined })).toEqual({ a: 1 });
    const cyclic: Record<string, unknown> = {}; cyclic["self"] = cyclic;
    expect(toJsonSafe(cyclic)).toEqual({ unserializable: true });
    expect(toJsonSafe({ big: "x".repeat(20_000) })).toMatchObject({ truncated: true });
  });

  it("ScannerAgent wraps the scan result", async () => {
    const scanner = { scanRepository: vi.fn().mockResolvedValue({ found: 4 }) };
    expect(await new ScannerAgent(scanner).run({ repositoryId: "demo" })).toEqual({ repositoryId: "demo", scan: { found: 4 } });
    expect(scanner.scanRepository).toHaveBeenCalledWith("demo");
  });

  it("toRemediatorInput dedupes and sorts advisory ids", () => {
    expect(toRemediatorInput({ repositoryId: "demo", report: report(["B", "A", "B"], 1) })).toEqual({
      repositoryId: "demo", vulnerabilityIds: ["A", "B"], actionableFindings: 3, suppressedFindings: 0,
    });
  });
});

describe("RemediationAgent", () => {
  const plan = (over: Record<string, unknown> = {}) => ({
    id: "plan_0123456789abcdef", status: "proposed", optimality: "exact", uncovered: [],
    upgrades: [{ name: "lodash", fromVersion: "4.17.15", toVersion: "4.18.0" }], ...over,
  });
  const input = { repositoryId: "demo", vulnerabilityIds: ["GHSA-A"], actionableFindings: 1, suppressedFindings: 0 };

  it("generates, validates, and records a plan_validated decision when the plan is valid", async () => {
    const remediation = {
      generatePlan: vi.fn().mockResolvedValue(plan()),
      validatePlan: vi.fn().mockResolvedValue({ status: "valid", eliminatedFindings: 6, fullyResolvesTargets: true }),
    };
    const memory = { recordDecision: vi.fn().mockResolvedValue({ id: "dec_0000000000000001" }) };
    const out = await new RemediationAgent(remediation as never, memory as never).run(input);
    expect(remediation.generatePlan).toHaveBeenCalledWith({ repositoryId: "demo", vulnerabilityIds: ["GHSA-A"] });
    expect(memory.recordDecision).toHaveBeenCalledWith(expect.objectContaining({
      type: "plan_validated", planId: "plan_0123456789abcdef", actor: "agent:remediator",
      evidence: { upgrades: ["lodash 4.17.15 -> 4.18.0"], fullyResolvesTargets: true },
    }));
    expect(out).toMatchObject({ planId: "plan_0123456789abcdef", upgradeCount: 1, validationStatus: "valid", fullyResolvesTargets: true, decisionId: "dec_0000000000000001" });
  });

  it("does not record a decision for an invalid or unverified plan", async () => {
    for (const status of ["invalid", "unverified", "stale"]) {
      const memory = { recordDecision: vi.fn() };
      const remediation = { generatePlan: vi.fn().mockResolvedValue(plan()), validatePlan: vi.fn().mockResolvedValue({ status, eliminatedFindings: 0, fullyResolvesTargets: false }) };
      const out = await new RemediationAgent(remediation as never, memory as never).run(input);
      expect(memory.recordDecision).not.toHaveBeenCalled();
      expect(out).toMatchObject({ validationStatus: status, decisionId: null, fullyResolvesTargets: false });
    }
  });

  it("skips validation when no action is needed, and flags uncovered packages and suppressed overlap", async () => {
    const remediation = { generatePlan: vi.fn().mockResolvedValue(plan({ status: "no_action_needed", upgrades: [] })), validatePlan: vi.fn() };
    const out = await new RemediationAgent(remediation as never, { recordDecision: vi.fn() } as never).run(input);
    expect(remediation.validatePlan).not.toHaveBeenCalled();
    expect(out.validationStatus).toBeNull();

    const r2 = { generatePlan: vi.fn().mockResolvedValue(plan({ upgrades: [], uncovered: [{}] })), validatePlan: vi.fn().mockResolvedValue({ status: "valid", eliminatedFindings: 0, fullyResolvesTargets: false }) };
    const o2 = await new RemediationAgent(r2 as never, { recordDecision: vi.fn() } as never).run({ ...input, suppressedFindings: 2 });
    expect(o2.notes.join(" ")).toContain("no verified upgrade");
    expect(o2.notes.join(" ")).toContain("suppressed on one package");
  });
});
