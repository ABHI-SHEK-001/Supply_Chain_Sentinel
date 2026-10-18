import express, { type Express } from "express";
import cors from "cors";
import type { Env } from "./config/env.js";
import type { GraphAnalysisService } from "./modules/graph-analysis/graph-analysis.service.js";
import type { RemediationService } from "./modules/remediation/remediation.service.js";
import type { RepositoryService } from "./modules/repositories/repository.service.js";
import { registerRoutes } from "./routes/index.js";
import type { GraphHealthCheck } from "./routes/health.routes.js";
import { errorHandler, notFoundHandler } from "./shared/errors/error-handler.js";

export interface AppDeps {
  env: Env;
  graphHealth?: GraphHealthCheck | undefined;
  repositoryService?: RepositoryService | undefined;
  graphAnalysisService?: GraphAnalysisService | undefined;
  remediationService?: RemediationService | undefined;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");

  const origins = deps.env.CORS_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: "25mb" })); // lockfiles are posted as text

  registerRoutes(app, {
    graphHealth: deps.graphHealth,
    repositoryService: deps.repositoryService,
    graphAnalysisService: deps.graphAnalysisService,
    remediationService: deps.remediationService,
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}