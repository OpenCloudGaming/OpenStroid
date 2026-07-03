import type { CookieOptions, Request, Response } from 'express';
import { serverConfig } from '../config.js';
import { decrypt, encrypt } from './crypto.js';

export interface BridgeSession {
  accessToken: string;
  refreshToken: string;
  userData?: unknown;
  user?: Record<string, unknown>;
  sessionId?: string | null;
  expiresAt?: number | null;
  usesAndroidTVIdentity?: boolean;
  createdAt: number;
  updatedAt: number;
}

function cookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: serverConfig.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function readSession(req: Request): BridgeSession | null {
  const raw = req.cookies?.[serverConfig.sessionCookieName];
  if (!raw || typeof raw !== 'string') return null;

  const session = decrypt<BridgeSession>(raw);
  if (!session?.accessToken || !session?.refreshToken) {
    return null;
  }

  return session;
}

export function writeSession(res: Response, session: BridgeSession): void {
  const maxAgeMs = serverConfig.sessionTtlSeconds * 1000;
  res.cookie(serverConfig.sessionCookieName, encrypt(session), cookieOptions(maxAgeMs));
}

export function clearSession(res: Response): void {
  res.clearCookie(serverConfig.sessionCookieName, cookieOptions(0));
}

export function createSession(input: {
  accessToken: string;
  refreshToken: string;
  userData?: unknown;
  user?: Record<string, unknown>;
  sessionId?: string | null;
  expiresAt?: number | null;
  usesAndroidTVIdentity?: boolean;
  existing?: BridgeSession | null;
}): BridgeSession {
  const now = Date.now();
  return {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    userData: input.userData ?? input.existing?.userData,
    user: input.user ?? input.existing?.user,
    sessionId: input.sessionId !== undefined ? input.sessionId : input.existing?.sessionId,
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : input.existing?.expiresAt,
    usesAndroidTVIdentity: input.usesAndroidTVIdentity ?? input.existing?.usesAndroidTVIdentity,
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
  };
}
