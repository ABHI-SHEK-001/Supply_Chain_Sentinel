import { Router } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { createRepositorySchema, repositoryIdSchema } from "./repository.schemas.js";
import type { RepositoryService } from "./repository.service.js";

export function createRepositoryRouter(
  service: Pick<RepositoryService, "register" | "list" | "get">,
): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      res.json({ success: true, data: await service.list() });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const input = createRepositorySchema.parse(req.body);
      const data = await service.register(input);
      res.status(201).json({ success: true, data });
    }),
  );

  router.get(
    "/:repositoryId",
    asyncHandler(async (req, res) => {
      const id = repositoryIdSchema.parse(req.params["repositoryId"]);
      res.json({ success: true, data: await service.get(id) });
    }),
  );

  return router;
}