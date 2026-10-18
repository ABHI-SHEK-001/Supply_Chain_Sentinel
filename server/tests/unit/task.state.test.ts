import { describe, expect, it } from "vitest";
import { canTransition, isTerminal, pipelineStatus, transition } from "../../src/modules/agents/task.state.js";
import { TASK_STATUSES, type AgentTask, type TaskStatus } from "../../src/modules/agents/task.types.js";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const task = (status: TaskStatus = "queued"): AgentTask => ({
  id: "task_0000000000000001", pipelineId: "pipe_0000000000000001", repositoryId: "demo", agent: "scanner", seq: 0, status,
  input: null, output: null, detail: null, createdAt: "2026-10-18T11:00:00.000Z", startedAt: null, finishedAt: null, handedOffTo: null,
});

describe("task state machine", () => {
  it("allows exactly the documented transitions", () => {
    const allowed = TASK_STATUSES.flatMap((a) => TASK_STATUSES.filter((b) => canTransition(a, b)).map((b) => `${a}>${b}`));
    expect(allowed.sort()).toEqual(["queued>failed", "queued>running", "queued>skipped", "running>failed", "running>succeeded"]);
  });

  it("treats succeeded, failed and skipped as terminal", () => {
    expect(["succeeded", "failed", "skipped"].every((s) => isTerminal(s as TaskStatus))).toBe(true);
    expect(isTerminal("queued") || isTerminal("running")).toBe(false);
  });

  it("stamps startedAt on running and finishedAt on terminal states, without mutating", () => {
    const q = task();
    const r = transition(q, "running", NOW, { input: { a: 1 } });
    expect(r).toMatchObject({ status: "running", startedAt: NOW.toISOString(), finishedAt: null, input: { a: 1 } });
    expect(q.status).toBe("queued");
    const s = transition(r, "succeeded", NOW, { output: { ok: true } });
    expect(s).toMatchObject({ status: "succeeded", finishedAt: NOW.toISOString(), output: { ok: true }, input: { a: 1 } });
  });

  it("records failure and skip reasons in detail", () => {
    expect(transition(task("running"), "failed", NOW, { detail: "boom" })).toMatchObject({ status: "failed", detail: "boom" });
    expect(transition(task(), "skipped", NOW, { detail: "nothing to do" })).toMatchObject({ status: "skipped", detail: "nothing to do" });
  });

  it("rejects illegal moves", () => {
    expect(() => transition(task("succeeded"), "running", NOW)).toThrow(/Illegal task transition/);
    expect(() => transition(task("queued"), "succeeded", NOW)).toThrow();
    expect(() => transition(task("failed"), "failed", NOW)).toThrow();
  });

  it("derives pipeline status", () => {
    expect(pipelineStatus([{ status: "succeeded" }, { status: "running" }])).toBe("running");
    expect(pipelineStatus([{ status: "succeeded" }, { status: "queued" }])).toBe("running");
    expect(pipelineStatus([{ status: "succeeded" }, { status: "failed" }, { status: "skipped" }])).toBe("failed");
    expect(pipelineStatus([{ status: "succeeded" }, { status: "succeeded" }, { status: "skipped" }])).toBe("succeeded");
  });
});
