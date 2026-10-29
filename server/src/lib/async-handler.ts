import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps async handlers so rejected promises reach the central error handler. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
