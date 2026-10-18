import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { repositoryIdSchema } from "../repositories/repository.schemas.js";
import type { AgentOrchestrator } from "./orchestrator.js";

const pipelineIdSchema = z.string().regex(/^pipe_[a-f0-9]{16}$/);
const taskIdSchema = z.string().regex(/^task_[a-f0-9]{16}$/);

/**
 * Mounted at /api/v1.
 * POST /repositories/:repositoryId/analyze starts the scanner -> triager -> remediator pipeline in the
 * background and returns 202 immediately; poll GET /pipelines/:pipelineId for progress.
 */
export function createAgentsRouter(
  orchestrator: Pick<AgentOrchestrator, "start" | "getPipeline" | "getTask" | "listPipelines">,
): Router {
  const router = Router();

  router.post(
    "/repositories/:repositoryId/analyze",
    asyncHandler(async (req, res) => {
      const repositoryId = repositoryIdSchema.parse(req.params["repositoryId"]);
      const pipeline = await orchestrator.start(repositoryId);
      res.status(202).json({ success: true, data: pipeline });
    }),
  );

  router.get(
    "/repositories/:repositoryId/pipelines",
    asyncHandler(async (req, res) => {
      const repositoryId = repositoryIdSchema.parse(req.params["repositoryId"]);
      res.json({ success: true, data: await orchestrator.listPipelines(repositoryId) });
    }),
  );

  router.get(
    "/pipelines/:pipelineId",
    asyncHandler(async (req, res) => {
      const id = pipelineIdSchema.parse(req.params["pipelineId"]);
      res.json({ success: true, data: await orchestrator.getPipeline(id) });
    }),
  );

  router.get(
    "/tasks/:taskId",
    asyncHandler(async (req, res) => {
      const id = taskIdSchema.parse(req.params["taskId"]);
      res.json({ success: true, data: await orchestrator.getTask(id) });
    }),
  );

  return router;
}
