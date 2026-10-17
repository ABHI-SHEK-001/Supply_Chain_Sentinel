import type { Express } from "express";
import { createRepositoryRouter } from "../modules/repositories/repository.routes.js";
import type { RepositoryService } from "../modules/repositories/repository.service.js";
import { createHealthRouter, type HealthDeps } from "./health.routes.js";

export interface RouteDeps extends HealthDeps {
  repositoryService?: RepositoryService | undefined;
}

export function registerRoutes(app: Express, deps: RouteDeps): void {
  app.use(createHealthRouter(deps));
  if (deps.repositoryService) {
    app.use("/api/v1/repositories", createRepositoryRouter(deps.repositoryService));
  }
}