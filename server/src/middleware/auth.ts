import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import type { Role } from '@prisma/client';

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let payload;
    try {
      payload = verifyAccessToken(header.slice('Bearer '.length));
    } catch {
      throw unauthorized('Access token is invalid or expired');
    }

    // The database is the authority for role and active status. A token cannot
    // carry a role change or keep a disabled account alive.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, isActive: true, lockedUntil: true },
    });
    if (!user || !user.isActive) throw unauthorized('Account is not active');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw unauthorized('Account is locked');

    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export const adminOnly = requireRole('ADMIN');
