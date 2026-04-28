import axios, { AxiosError } from 'axios';
import { randomUUID } from 'node:crypto';
import { serverConfig } from '../config.js';
import { createSession, type BridgeSession } from './session.js';
import { sha256 } from './crypto.js';

const upstreamClient = axios.create({
  baseURL: serverConfig.upstreamBaseUrl,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

export interface UpstreamTokens {
  access_token: string;
  refresh_token: string;
  user_data?: unknown;
}

export interface CookieAuthCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

interface CookieAuthSession {
  cookieHeader: string;
  cookies: CookieAuthCookie[];
}

const refreshRequests = new Map<string, Promise<UpstreamTokens>>();
const COOKIE_AUTH_PREFIX = 'cookie-auth:';
const cookieAuthSessions = new Map<string, CookieAuthSession>();

export function createCookieAuthToken(cookieHeader: string, cookies: CookieAuthCookie[] = []): string {
  const id = randomUUID();
  cookieAuthSessions.set(id, { cookieHeader, cookies });
  return `${COOKIE_AUTH_PREFIX}${id}`;
}

export function readCookieAuthToken(value: string): string | null {
  if (!value.startsWith(COOKIE_AUTH_PREFIX)) {
    return null;
  }

  try {
    const payload = value.slice(COOKIE_AUTH_PREFIX.length);
    const stored = cookieAuthSessions.get(payload)?.cookieHeader;
    if (stored) {
      return stored;
    }

    return Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export function isCookieAuthToken(value: string): boolean {
  return Boolean(readCookieAuthToken(value));
}

export function getCookieAuthCookies(value: string): CookieAuthCookie[] {
  if (!value.startsWith(COOKIE_AUTH_PREFIX)) {
    return [];
  }

  return cookieAuthSessions.get(value.slice(COOKIE_AUTH_PREFIX.length))?.cookies ?? [];
}

function upstreamAuthHeaders(accessToken: string): Record<string, string> {
  const cookieHeader = readCookieAuthToken(accessToken);
  if (cookieHeader) {
    const cookies = getCookieAuthCookies(accessToken);
    const headers: Record<string, string> = {
      Cookie: cookieHeader,
      Origin: serverConfig.upstreamBaseUrl,
      Referer: `${serverConfig.upstreamBaseUrl}/`,
    };
    const accessCookie = cookies.find((cookie) => cookie.name === 'access_token');
    const boosteroidAuthCookie = cookies.find((cookie) => cookie.name === 'boosteroid_auth');
    if (accessCookie?.value) {
      headers.Authorization = normalizeAuthorizationValue(accessCookie.value);
    }
    if (boosteroidAuthCookie?.value) {
      headers['Authorization-Data'] = boosteroidAuthCookie.value;
    }
    return headers;
  }

  return { Authorization: normalizeAuthorizationValue(accessToken) };
}

async function upstreamGet<T>(accessToken: string, path: string): Promise<T> {
  const { data } = await upstreamClient.get(path, {
    headers: upstreamAuthHeaders(accessToken),
  });
  return data as T;
}

async function upstreamPost<T>(accessToken: string, path: string, body: unknown = {}): Promise<T> {
  const { data } = await upstreamClient.post(path, body, {
    headers: upstreamAuthHeaders(accessToken),
  });
  return data as T;
}

function normalizeAuthorizationValue(accessToken: string): string {
  const plusAsSpace = accessToken.replace(/\+/g, ' ');
  let decoded = plusAsSpace;
  try {
    decoded = decodeURIComponent(plusAsSpace);
  } catch {
    decoded = plusAsSpace;
  }

  const trimmed = decoded.trim();
  if (/^Bearer\s+/i.test(trimmed)) {
    return trimmed.replace(/^Bearer\s+/i, 'Bearer ');
  }

  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
    return `Bearer ${trimmed}`;
  }

  return trimmed;
}

export function unwrapRecord(data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object' && 'data' in data && data.data && typeof data.data === 'object') {
    return data.data as Record<string, unknown>;
  }
  return (data ?? {}) as Record<string, unknown>;
}

export function normalizeError(error: unknown): { status: number; message: string; details?: unknown } {
  if (error instanceof Error) {
    const typedError = error as Error & { status?: number; details?: unknown };
    if (typeof typedError.status === 'number') {
      return {
        status: typedError.status,
        message: typedError.message,
        details: typedError.details,
      };
    }
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 502;
    const payload = error.response?.data as Record<string, unknown> | undefined;
    const nestedError = payload?.error as Record<string, unknown> | undefined;
    const message =
      (payload?.message as string | undefined) ??
      (payload?.error_message as string | undefined) ??
      (nestedError?.message as string | undefined) ??
      error.message ??
      'Unexpected upstream error';

    return {
      status,
      message,
      details: payload?.errors ?? payload?.error,
    };
  }

  return {
    status: 500,
    message: error instanceof Error ? error.message : 'Unexpected server error',
  };
}

export async function loginUpstream(payload: Record<string, string | boolean>): Promise<UpstreamTokens> {
  const { data } = await upstreamClient.post('/api/v1/auth/login', payload);
  const envelope = unwrapRecord(data);

  return {
    access_token: String(envelope.access_token ?? ''),
    refresh_token: String(envelope.refresh_token ?? ''),
    user_data: envelope.user_data,
  };
}

export async function getUpstreamUser(accessToken: string): Promise<Record<string, unknown>> {
  const data = await upstreamGet<unknown>(accessToken, '/api/v1/user');
  return unwrapRecord(data);
}

export async function getInstalledGamesUpstream(accessToken: string): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(accessToken, '/api/v1/boostore/applications/installed');

  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown[] }).data)) {
    return (data as { data: unknown[] }).data;
  }
  if (data && typeof data === 'object' && Array.isArray((data as { applications?: unknown[] }).applications)) {
    return (data as { applications: unknown[] }).applications;
  }

  return [];
}

export async function getApplicationUpstream(accessToken: string, appId: number): Promise<Record<string, unknown>> {
  const data = await upstreamGet<unknown>(accessToken, `/api/v1/boostore/applications/${appId}`);
  return unwrapRecord(data);
}

export async function getStreamingGatewaysUpstream(accessToken: string): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(accessToken, '/api/v1/streaming/gateways');
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown[] }).data)) {
    return (data as { data: unknown[] }).data;
  }
  return [];
}

export async function enqueueStreamingSessionUpstream(accessToken: string, appId: number): Promise<Record<string, unknown>> {
  const data = await upstreamPost<unknown>(accessToken, '/api/v2/streaming/session/enqueue', { appId });
  return unwrapRecord(data);
}

export async function dequeueStreamingSessionUpstream(accessToken: string): Promise<Record<string, unknown>> {
  const data = await upstreamPost<unknown>(accessToken, '/api/v2/streaming/session/dequeue', {});
  return unwrapRecord(data);
}

export async function getLastSessionUpstream(accessToken: string): Promise<Record<string, unknown>> {
  const data = await upstreamGet<unknown>(accessToken, '/api/v1/streaming/user/last-session');
  return unwrapRecord(data);
}

export async function getLastSessionLiveUpstream(accessToken: string): Promise<Record<string, unknown>> {
  const data = await upstreamGet<unknown>(accessToken, '/api/v1/streaming/user/last-session/live');
  return unwrapRecord(data);
}

export async function getActiveSessionsUpstream(accessToken: string): Promise<Record<string, unknown>> {
  const data = await upstreamGet<unknown>(accessToken, '/api/v1/streaming/user/active-sessions');
  return unwrapRecord(data);
}

export async function startStreamingSessionV1Upstream(accessToken: string, appId: number): Promise<Record<string, unknown>> {
  const data = await upstreamPost<unknown>(accessToken, '/api/v1/streaming/session/start', { appId });
  return unwrapRecord(data);
}

export async function startStreamingSessionV2Upstream(accessToken: string, appId: number, sessionToken: string): Promise<Record<string, unknown>> {
  const data = await upstreamPost<unknown>(accessToken, '/api/v2/streaming/session/start', { appId, sessionToken });
  return unwrapRecord(data);
}

export async function logoutUpstream(accessToken: string): Promise<void> {
  await upstreamClient.post(
    '/api/v2/auth/logout',
    {},
    {
      headers: upstreamAuthHeaders(accessToken),
    },
  );
}

async function refreshUpstream(refreshToken: string): Promise<UpstreamTokens> {
  const { data } = await upstreamClient.post('/api/v1/auth/refresh-token', {
    refresh_token: refreshToken,
  });
  const envelope = unwrapRecord(data);

  return {
    access_token: String(envelope.access_token ?? ''),
    refresh_token: String(envelope.refresh_token ?? refreshToken),
    user_data: envelope.user_data,
  };
}

async function refreshSession(session: BridgeSession): Promise<BridgeSession> {
  const lockKey = sha256(session.refreshToken);
  let request = refreshRequests.get(lockKey);

  if (!request) {
    request = refreshUpstream(session.refreshToken).finally(() => {
      refreshRequests.delete(lockKey);
    });
    refreshRequests.set(lockKey, request);
  }

  const refreshedTokens = await request;
  return createSession({
    accessToken: refreshedTokens.access_token,
    refreshToken: refreshedTokens.refresh_token,
    userData: refreshedTokens.user_data,
    existing: session,
  });
}

export async function withRefresh<T>(
  session: BridgeSession,
  operation: (accessToken: string) => Promise<T>,
): Promise<{ session: BridgeSession; result: T }> {
  try {
    return {
      session,
      result: await operation(session.accessToken),
    };
  } catch (error) {
    const isUnauthorized = error instanceof AxiosError ? error.response?.status === 401 : false;

    if (!isUnauthorized || readCookieAuthToken(session.accessToken)) {
      throw error;
    }

    const refreshedSession = await refreshSession(session);
    const result = await operation(refreshedSession.accessToken);
    return { session: refreshedSession, result };
  }
}
