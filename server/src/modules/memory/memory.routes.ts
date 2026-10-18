import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { repositoryIdSchema } from "../repositories/repository.schemas.js";
import { DECISION_STATUSES, DECISION_TYPES } from "./memory.types.js";
import type { MemoryService } from "./memory.service.js";

const vulnerabilityId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const packageVersionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9@/._:+~-]{0,299}$/);
const planId = z.string().regex(/^plan_[a-f0-9]{16}$/);
const decisionId = z.string().regex(/^dec_[a-f0-9]{16}$/);

export const recordDecisionSchema = z.object({
  repositoryId: repositoryIdSchema,
  type: z.enum(DECISION_TYPES),
  vulnerabilityId: vulnerabilityId.optional(),
  packageVersionId: packageVersionId.optional(),
  planId: planId.optional(),
  explanation: z.string().trim().min(1).max(2000),
  actor: z.string().trim().min(1).max(100),
  evidence: z.record(z.string(), z.unknown()).optional(),
  validUntil: z.string().datetime({ offset: true }).optional(),
});

export const searchDecisionsSchema = z.object({
  repositoryId: repositoryIdSchema,
  type: z.enum(DECISION_TYPES).optional(),
  vulnerabilityId: vulnerabilityId.optional(),
  packageVersionId: packageVersionId.optional(),
  status: z.enum(DECISION_STATUSES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const revokeSchema = z.object({
  repositoryId: repositoryIdSchema,
  reason: z.string().trim().min(1).max(500).optional(),
});

/** Mounted at /api/v1/memory. Memory is always scoped to one repository. */
export function createMemoryRouter(service: Pick<MemoryService, "recordDecision" | "search" | "revoke">): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const filters = searchDecisionsSchema.parse(req.query);
      res.json({ success: true, data: await service.search(filters) });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const input = recordDecisionSchema.parse(req.body);
      res.status(201).json({ success: true, data: await service.recordDecision(input) });
    }),
  );

  router.post(
    "/:decisionId/revoke",
    asyncHandler(async (req, res) => {
      const id = decisionId.parse(req.params["decisionId"]);
      const body = revokeSchema.parse(req.body);
      res.json({ success: true, data: await service.revoke(body.repositoryId, id, body.reason) });
    }),
  );

  return router;
}
