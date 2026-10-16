import express, { type Express } from "express";
import cors from "cors";
import type { Env } from "./config/env.js";
import { registerRoutes } from "./routes/index.js";
import type { GraphHealthCheck } from "./routes/health.routes.js";
import { errorHandler, notFoundHandler } from "./shared/errors/error-handler.js";

export interface AppDeps {
    env: Env;
    graphHealth?: GraphHealthCheck | undefined;
}

export function createApp(deps: AppDeps): Express {
    const app = express();
    app.disable("x-powered-by");

    const origins = deps.env.CORS_ORIGIN.split(",")
        .map((o) => o.trim())
        .filter(Boolean);
    app.use(cors({ origin: origins }));
    app.use(express.json({ limit: "1mb" }));

    registerRoutes(app, { graphHealth: deps.graphHealth });

    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}