import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { repositoryIdSchema } from "../repositories/repository.schemas.js";
import type { RemediationService } from "./remediation.service.js";

const vulnerabilityId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);

const createPlanSchema = z.object({
    repositoryId: repositoryIdSchema,
    vulnerabilityIds: z.array(vulnerabilityId).min(1).max(200).optional(),
});

const listQuery = z.object({ repositoryId: repositoryIdSchema.optional() });
const planIdSchema = z.string().regex(/^plan_[a-f0-9]{16}$/);

/** Mounted at /api/v1/remediation-plans. Plans are proposals only; nothing is applied. */
export function createRemediationRouter(
    service: Pick<RemediationService, "generatePlan" | "listPlans" | "getPlan" | "validatePlan">,
): Router {
    const router = Router();

    router.get(
        "/",
        asyncHandler(async (req, res) => {
            const { repositoryId } = listQuery.parse(req.query);
            res.json({ success: true, data: await service.listPlans(repositoryId) });
        }),
    );

    router.post(
        "/",
        asyncHandler(async (req, res) => {
            const input = createPlanSchema.parse(req.body);
            res.status(201).json({ success: true, data: await service.generatePlan(input) });
        }),
    );

    router.get(
        "/:planId",
        asyncHandler(async (req, res) => {
            const id = planIdSchema.parse(req.params["planId"]);
            res.json({ success: true, data: await service.getPlan(id) });
        }),
    );

    router.post(
        "/:planId/validate",
        asyncHandler(async (req, res) => {
            const id = planIdSchema.parse(req.params["planId"]);
            res.json({ success: true, data: await service.validatePlan(id) });
        }),
    );

    return router;
}