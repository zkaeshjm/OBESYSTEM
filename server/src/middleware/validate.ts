import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { badRequest } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

/** Replaces the request source with the parsed, stripped value. */
export function validate(schema: ZodType, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        badRequest(
          'Request validation failed',
          result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          }))
        )
      );
    }
    if (source === 'body') req.body = result.data;
    else if (source === 'query') {
      // Express 5 exposes req.query through a prototype getter; shadow it with
      // the parsed value on this request rather than mutating the original.
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else req.params = result.data as typeof req.params;
    next();
  };
}
