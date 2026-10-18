import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGraphClient } from "../../src/infrastructure/graph/falkordb-client.js";
import { GraphManager } from "../../src/infrastructure/graph/graph-manager.js";
import { RemediationAgent, ScannerAgent, TriageAgent } from "../../src/modules/agents/agents.js";
import { AgentOrchestrator } from "../../src/modules/agents/orchestrator.js";
import { TaskStore } from "../../src/modules/agents/task.store.js";
import type { AgentTask } from "../../src/modules/agents/task.types.js";
import { TriageService } from "../../src/modules/agents/triage.js";
import { DependencyIngestionService } from "../../src/modules/ingestion/dependency-ingestion.service.js";
import { MemoryService } from "../../src/modules/memory/memory.service.js";
import { RemediationService } from "../../src/modules/remediation/remediation.service.js";
import { RepositoryService } from "../../src/modules/repositories/repository.service.js";
import type {
  NormalizedVulnerability,
  OsvPackageQuery,
  PackageLookup,
  VulnerabilityFetch,
} from "../../src/modules/vulnerabilities/osv.types.js";
import { VulnerabilityService } from "../../src/modules/vulnerabilities/vulnerability.service.js";

const enabled = process.env["FALKORDB_INTEGRATION"] === "1";
const fixture = readFileSync(new URL("../fixtures/npm/package-lock.v3.json", import.meta.url), "utf8");

function vuln(id: string, pkg: string, fixed: string): NormalizedVulnerability {
  return {
    id,
    aliases: [],
    summary: `simulated ${id}`,
    details: null,
    published: null,
    modified: null,
    withdrawn: null,
    severityLabel: "HIGH",
    severityJson: null,
    references: [],
    affected: [
      {
        ecosystem: "npm",
        name: pkg,
        fixedVersions: [fixed],
        ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed }] }],
      },
    ],
    sourceUrl: `https://osv.dev/vulnerability/${id}`,
  };
}

const CATALOG: Record<string, NormalizedVulnerability> = {
  "GHSA-direct": vuln("GHSA-direct", "lib-a", "1.0.1"),
  "OSV-d": vuln("OSV-d", "lib-d", "1.2.0"),
  "OSV-d2": vuln("OSV-d2", "lib-d", "1.1.5"),
  "GHSA-major": vuln("GHSA-major", "lib-c", "2.0.0"),
};
const BY_PACKAGE: Record<string, string[]> = {
  "lib-a@1.0.0": ["GHSA-direct"],
  "lib-c@1.0.0": ["GHSA-major"],
  "lib-d@1.1.0": ["OSV-d", "OSV-d2"],
};

const fakeOsv = {
  queryPackages: async (qs: readonly OsvPackageQuery[]): Promise<PackageLookup[]> =>
    qs.map((q): PackageLookup => ({ status: "ok", vulnIds: BY_PACKAGE[`${q.name}@${q.version}`] ?? [] })),
  getVulnerabilities: async (ids: readonly string[]): Promise<Map<string, VulnerabilityFetch>> =>
    new Map(
      ids.map((id): [string, VulnerabilityFetch] => [
        id,
        { status: "ok", vulnerability: CATALOG[id] as NormalizedVulnerability },
      ]),
    ),
};

const DIRECT_PV = "npm:lib-a@1.0.0";

describe.skipIf(!enabled)("memory, triage and agent pipeline (FalkorDB)", () => {
  const graphName = `sentinel_agents_${Date.now()}`;
  let gm: GraphManager;
  let memory: MemoryService;
  let triage: TriageService;
  let store: TaskStore;
  let orchestrator: AgentOrchestrator;

  beforeAll(async () => {
    gm = new GraphManager(createGraphClient({ FALKORDB_HOST: "127.0.0.1", FALKORDB_PORT: 6379 }), graphName);
    const repos = new RepositoryService(gm, new DependencyIngestionService(gm));
    await repos.register({ name: "demo", ecosystem: "npm", lockfile: fixture });
    const scanner = new VulnerabilityService(gm, fakeOsv);
    await scanner.scanRepository("demo");

    memory = new MemoryService(gm);
    triage = new TriageService(gm, memory);
    store = new TaskStore(gm);
    orchestrator = new AgentOrchestrator(store, {
      scanner: new ScannerAgent(scanner),
      triager: new TriageAgent(triage),
      remediator: new RemediationAgent(new RemediationService(gm, fakeOsv), memory),
    });
  });

  afterAll(async () => {
    await gm.deleteGraph().catch(() => {});
    await gm.close();
  });

  const count = async (cypher: string) => (await gm.readQuery<{ c: number }>(cypher)).data?.[0]?.c;

  it("triages real findings and honors, supersedes and revokes risk decisions", async () => {
    const first = await triage.triage("demo");
    expect(first.summary).toMatchObject({ totalFindings: 4, actionable: 4, suppressed: 0 });
    for (const f of first.actionable) expect(f.evidence.reduce((s, e) => s + e.points, 0)).toBe(f.score);

    const accepted = await memory.recordDecision({
      repositoryId: "demo", type: "accepted_risk", vulnerabilityId: "GHSA-direct", packageVersionId: DIRECT_PV,
      explanation: "not reachable in our build", actor: "alice",
    });
    expect(accepted).toMatchObject({ status: "active", severityAtDecision: "HIGH", fixAvailableAtDecision: true });

    const hidden = await triage.triage("demo");
    expect(hidden.summary).toMatchObject({ actionable: 3, suppressed: 1 });
    expect(hidden.suppressed[0]).toMatchObject({ vulnerabilityId: "GHSA-direct", decisionId: accepted.id });

    // a newer decision on the same finding supersedes the older one
    const newer = await memory.recordDecision({
      repositoryId: "demo", type: "accepted_risk", vulnerabilityId: "GHSA-direct", packageVersionId: DIRECT_PV,
      explanation: "still not reachable", actor: "bob",
    });
    const superseded = await memory.search({ repositoryId: "demo", status: "superseded" });
    expect(superseded.map((d) => d.id)).toEqual([accepted.id]);
    expect(superseded[0]!.supersededBy).toBe(newer.id);

    // a decision for a finding that does not exist is refused
    await expect(
      memory.recordDecision({ repositoryId: "demo", type: "accepted_risk", vulnerabilityId: "GHSA-nope", packageVersionId: DIRECT_PV, explanation: "x", actor: "alice" }),
    ).rejects.toMatchObject({ statusCode: 409 });

    await memory.revoke("demo", newer.id, "reconsidered");
    expect((await triage.triage("demo")).summary).toMatchObject({ actionable: 4, suppressed: 0 });
    expect(await count("MATCH ()-[r:RECORDED]->() RETURN count(r) AS c")).toBe(2);
  });

  it("lets a decision lapse when its validity window ends", async () => {
    const d = await memory.recordDecision({
      repositoryId: "demo", type: "false_positive", vulnerabilityId: "OSV-d", packageVersionId: "npm:lib-d@1.1.0",
      explanation: "scanner mismatch", actor: "alice",
    });
    expect((await triage.triage("demo")).summary.suppressed).toBe(1);

    await gm.query("MATCH (x:Decision {id: $id}) SET x.validUntil = $v", { id: d.id, v: "2020-01-01T00:00:00.000Z" });
    const after = await triage.triage("demo");
    expect(after.summary).toMatchObject({ actionable: 4, suppressed: 0 });
    expect(after.memoryTransitions).toEqual([expect.objectContaining({ decisionId: d.id, from: "active", to: "expired" })]);
    expect((await memory.search({ repositoryId: "demo", status: "expired" })).map((x) => x.id)).toEqual([d.id]);
  });

  it("runs scanner -> triager -> remediator as linked, persisted tasks", async () => {
    const started = await orchestrator.start("demo");
    expect(started.status).toBe("running");
    await orchestrator.waitForIdle();

    const done = await orchestrator.getPipeline(started.id);
    expect(done.status).toBe("succeeded");
    expect(done.tasks.map((t) => `${t.agent}:${t.status}`)).toEqual(["scanner:succeeded", "triager:succeeded", "remediator:succeeded"]);
    expect(done.tasks.map((t) => t.handedOffTo)).toEqual([done.tasks[1]!.id, done.tasks[2]!.id, null]);
    expect(done.tasks[2]!.output).toMatchObject({ planStatus: "proposed", upgradeCount: 3, validationStatus: "valid", fullyResolvesTargets: true });

    const decisions = await memory.search({ repositoryId: "demo", type: "plan_validated" });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ actor: "agent:remediator", planId: (done.tasks[2]!.output as { planId: string }).planId });

    expect(await count("MATCH ()-[r:HAS_TASK]->() RETURN count(r) AS c")).toBe(3);
    expect(await count("MATCH ()-[r:HANDED_OFF_TO]->() RETURN count(r) AS c")).toBe(2);
    expect((await orchestrator.getTask(done.tasks[0]!.id)).handedOffTo).toBe(done.tasks[1]!.id);
    expect(await orchestrator.listPipelines("demo")).toHaveLength(1);
  });

  it("marks tasks left unfinished by a crash as failed or skipped on restart", async () => {
    const now = new Date().toISOString();
    const mk = (seq: number, agent: AgentTask["agent"], status: AgentTask["status"]): AgentTask => ({
      id: `task_00000000000000a${seq}`, pipelineId: "pipe_00000000000000aa", repositoryId: "demo", agent, seq, status,
      input: null, output: null, detail: null, createdAt: now, startedAt: null, finishedAt: null, handedOffTo: null,
    });
    await store.create([mk(0, "scanner", "running"), mk(1, "triager", "queued"), mk(2, "remediator", "queued")]);

    expect(await orchestrator.recoverInterrupted()).toBe(3);
    const tasks = await store.loadPipeline("pipe_00000000000000aa");
    expect(tasks.map((t) => t.status)).toEqual(["failed", "skipped", "skipped"]);
    expect(tasks[0]!.detail).toContain("restart");
    expect(await orchestrator.recoverInterrupted()).toBe(0);
  });
});
