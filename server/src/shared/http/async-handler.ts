import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Forwards rejected promises to the error handler (works on Express 4 and 5). */
export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };