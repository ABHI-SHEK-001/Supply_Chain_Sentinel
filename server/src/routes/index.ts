import type { Express } from "express";
import { createHealthRouter, type HealthDeps } from "./health.routes.js";

export type RouteDeps = HealthDeps;

export function registerRoutes(app: Express, deps: RouteDeps): void {
  app.use(createHealthRouter(deps));
}