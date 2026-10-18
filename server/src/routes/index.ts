import type { Express } from "express";
import { createGraphAnalysisRouter } from "../modules/graph-analysis/graph-analysis.routes.js";
import type { GraphAnalysisService } from "../modules/graph-analysis/graph-analysis.service.js";
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
}