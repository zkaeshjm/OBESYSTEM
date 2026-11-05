import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
    meta: { requestId: res.locals.requestId },
  });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: unknown;

  if (error instanceof AppError) {
    status = error.status;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      status = 409;
      code = 'DUPLICATE';
      message = 'A record with these details already exists';
      details = { fields: error.meta?.target };
    } else if (error.code === 'P2003' || error.code === 'P2014') {
      status = 409;
      code = 'RELATION_CONFLICT';
      message = 'The operation would break an existing academic relationship';
    } else if (error.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'The requested record does not exist';
    }
  } else if (error instanceof Error) {
    const pgCode = (error as { code?: string }).code;
    if (pgCode === '23505') {
      status = 409;
      code = 'DUPLICATE';
      message = 'A record with these details already exists';
    } else if (pgCode === '23503' || pgCode === '23514') {
      status = 409;
      code = 'INTEGRITY_ERROR';
      message = 'The operation violates an academic data integrity rule';
    } else if (pgCode === 'P0001') {
      status = 409;
      code = 'INTEGRITY_ERROR';
      message = error.message;
    }
  }

  if (status >= 500) {
    req.log?.error({ err: error, requestId: res.locals.requestId }, 'request failed');
  } else {
    req.log?.warn(
      { code, status, requestId: res.locals.requestId, path: req.path },
      'request rejected'
    );
  }

  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    meta: { requestId: res.locals.requestId },
  });
}
