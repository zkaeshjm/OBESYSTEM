import type { Response } from 'express';

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

export function readPagination(query: Record<string, unknown>, maxLimit = 100): Pagination {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.parseInt(String(query.limit ?? '25'), 10) || 25)
  );
  return { page, limit, skip: (page - 1) * limit };
}

export function sendData<T>(
  res: Response,
  data: T,
  options: { status?: number; meta?: Record<string, unknown> } = {}
) {
  const { status = 200, meta = {} } = options;
  return res.status(status).json({
    data,
    meta: { requestId: res.locals.requestId, ...meta },
  });
}

export function sendPaginated<T>(
  res: Response,
  data: T[],
  pagination: Pagination,
  total: number
) {
  return sendData(res, data, {
    meta: { page: pagination.page, limit: pagination.limit, total },
  });
}
