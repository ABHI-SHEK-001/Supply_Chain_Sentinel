import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { repositoryIdSchema } from "../repositories/repository.schemas.js";
import type { GraphAnalysisService } from "./graph-analysis.service.js";

const analysisQuery = z.object({
    maxDepth: z.coerce.number().int().min(1).max(50).default(30),
    maxPaths: z.coerce.number().int().min(1).max(100).default(10),
    vulnerabilityId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/).optional(),
});

const graphQuery = z.object({
    limit: z.coerce.number().int().min(1).max(20000).default(5000),
});

/** Mounted at /api/v1/repositories. */
export function createGraphAnalysisRouter(
    service: Pick<GraphAnalysisService, "getGraph" | "analyzeRepository">,
): Router {
    const router = Router();

    router.get(
        "/:repositoryId/graph",
        asyncHandler(async (req, res) => {
            const slug = repositoryIdSchema.parse(req.params["repositoryId"]);
            const { limit } = graphQuery.parse(req.query);
            res.json({ success: true, data: await service.getGraph(slug, limit) });
        }),
    );

    router.get(
        "/:repositoryId/vulnerabilities",
        asyncHandler(async (req, res) => {
            const slug = repositoryIdSchema.parse(req.params["repositoryId"]);
            const q = analysisQuery.parse(req.query);
            const data = await service.analyzeRepository(slug, {
                maxDepth: q.maxDepth,
                maxPathsPerFinding: q.maxPaths,
                ...(q.vulnerabilityId ? { vulnerabilityId: q.vulnerabilityId } : {}),
            });
            res.json({ success: true, data });
        }),
    );

    return router;
}