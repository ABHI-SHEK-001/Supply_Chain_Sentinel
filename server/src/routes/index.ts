import type { Express } from "express";
import { createMcpRouter } from "../mcp/mcp.routes.js";
import type { McpDeps } from "../mcp/mcp-server.js";
import { createAgentsRouter } from "../modules/agents/agents.routes.js";
import type { AgentOrchestrator } from "../modules/agents/orchestrator.js";
import { createGraphAnalysisRouter } from "../modules/graph-analysis/graph-analysis.routes.js";
import type { GraphAnalysisService } from "../modules/graph-analysis/graph-analysis.service.js";
import { createMemoryRouter } from "../modules/memory/memory.routes.js";
import type { MemoryService } from "../modules/memory/memory.service.js";
import { createRemediationRouter } from "../modules/remediation/remediation.routes.js";
import type { RemediationService } from "../modules/remediation/remediation.service.js";
import { createRepositoryRouter } from "../modules/repositories/repository.routes.js";
import type { RepositoryService } from "../modules/repositories/repository.service.js";
import { createVulnerabilityRouter } from "../modules/vulnerabilities/vulnerability.routes.js";
import { createHealthRouter, type HealthDeps } from "./health.routes.js";

export interface RouteDeps extends HealthDeps {
  repositoryService?: RepositoryService | undefined;
  graphAnalysisService?: GraphAnalysisService | undefined;
  remediationService?: RemediationService | undefined;
  memoryService?: MemoryService | undefined;
  orchestrator?: AgentOrchestrator | undefined;
  mcp?: McpDeps | undefined;
}

export function registerRoutes(app: Express, deps: RouteDeps): void {
  app.use(createHealthRouter(deps));
  if (deps.repositoryService) {
    app.use("/api/v1/repositories", createRepositoryRouter(deps.repositoryService));
  }
  if (deps.graphAnalysisService) {
    app.use("/api/v1/repositories", createGraphAnalysisRouter(deps.graphAnalysisService));
    app.use("/api/v1/vulnerabilities", createVulnerabilityRouter(deps.graphAnalysisService));
  }
  if (deps.remediationService) {
    app.use("/api/v1/remediation-plans", createRemediationRouter(deps.remediationService));
  }
  if (deps.memoryService) {
    app.use("/api/v1/memory", createMemoryRouter(deps.memoryService));
  }
  if (deps.orchestrator) {
    // Adds POST /repositories/:id/analyze, GET /repositories/:id/pipelines, GET /pipelines/:id, GET /tasks/:id
    app.use("/api/v1", createAgentsRouter(deps.orchestrator));
  }
  if (deps.mcp) {
    app.use("/mcp", createMcpRouter(deps.mcp));
  }
}
