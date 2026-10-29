import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { env } from '../config/env.js';
import type { Role } from '@prisma/client';

export const REFRESH_COOKIE = 'obe_refresh';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  email: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m`,
    issuer: 'obe-system',
    audience: 'obe-client',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'obe-system',
    audience: 'obe-client',
  });
  if (typeof decoded === 'string' || !decoded.sub) {
    throw new Error('Invalid access token payload');
  }
  return {
    sub: String(decoded.sub),
    role: decoded.role as Role,
    email: String(decoded.email),
  };
}

/** Opaque refresh token: only its SHA-256 hash is stored in PostgreSQL. */
export function createRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(48).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { token, hash, expiresAt };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    expires: expiresAt,
    path: '/api/v1/auth',
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth',
  });
}
