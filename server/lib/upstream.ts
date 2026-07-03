import axios, { AxiosError } from 'axios';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { serverConfig } from '../config.js';
import { createSession, type BridgeSession } from './session.js';
import { decrypt, encrypt, sha256 } from './crypto.js';
import {
  ANDROID_TV_ENTRYPOINT_COOKIE,
  androidTvRequestHeaders,
  appendAndroidTvEntrypointCookie,
} from './androidTvIdentity.js';

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
  createdAt: number;
  updatedAt: number;
}

interface PersistedCookieAuthStore {
  version: 1;
  sessions: Record<string, CookieAuthSession>;
}

const refreshRequests = new Map<string, Promise<UpstreamTokens>>();
const COOKIE_AUTH_PREFIX = 'cookie-auth:';
const cookieAuthSessions = new Map<string, CookieAuthSession>();
type UpstreamAuthInput = string | BridgeSession;

function isFreshCookieSession(session: CookieAuthSession): boolean {
  const authCookies = session.cookies.filter((cookie) => (
    cookie.name === 'access_token' ||
    cookie.name === 'refresh_token' ||
    cookie.name === 'boosteroid_auth'
  ));
  if (authCookies.length === 0) return Boolean(session.cookieHeader);
  return authCookies.some((cookie) => cookie.expires <= 0 || cookie.expires * 1000 > Date.now() + 60_000);
}

function loadPersistedCookieAuthSessions(): void {
  const raw = fs.existsSync(serverConfig.cookieAuthStorePath)
    ? fs.readFileSync(serverConfig.cookieAuthStorePath, 'utf8')
    : '';
  if (!raw) return;

  const store = decrypt<PersistedCookieAuthStore>(raw);
  if (!store?.sessions) return;

  for (const [id, session] of Object.entries(store.sessions)) {
    if (session?.cookieHeader && isFreshCookieSession(session)) {
      cookieAuthSessions.set(id, session);
    }
  }
}

function persistCookieAuthSessions(): void {
  const sessions = Object.fromEntries(
    [...cookieAuthSessions.entries()].filter(([, session]) => isFreshCookieSession(session)),
  );

  fs.mkdirSync(path.dirname(serverConfig.cookieAuthStorePath), { recursive: true });
  fs.writeFileSync(serverConfig.cookieAuthStorePath, encrypt({ version: 1, sessions }), 'utf8');
}

loadPersistedCookieAuthSessions();

export function restoreCookieAuthToken(value: string, cookieHeader: string, cookies: CookieAuthCookie[] = []): boolean {
  if (!value.startsWith(COOKIE_AUTH_PREFIX) || !cookieHeader) {
    return false;
  }

  const id = value.slice(COOKIE_AUTH_PREFIX.length);
  const now = Date.now();
  cookieAuthSessions.set(id, {
    cookieHeader,
    cookies,
    createdAt: cookieAuthSessions.get(id)?.createdAt ?? now,
    updatedAt: now,
  });
  persistCookieAuthSessions();
  return true;
}

export function createCookieAuthToken(cookieHeader: string, cookies: CookieAuthCookie[] = []): string {
  const id = randomUUID();
  const now = Date.now();
  cookieAuthSessions.set(id, { cookieHeader, cookies, createdAt: now, updatedAt: now });
  persistCookieAuthSessions();
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

function getAccessToken(auth: UpstreamAuthInput): string {
  return typeof auth === 'string' ? auth : auth.accessToken;
}

function usesAndroidTVIdentity(auth: UpstreamAuthInput): boolean {
  return typeof auth !== 'string' && Boolean(auth.usesAndroidTVIdentity);
}

function getAuthDataToken(auth: UpstreamAuthInput): string {
  if (typeof auth === 'string') return '';
  if (typeof auth.userData === 'string') return auth.userData;
  if (!auth.userData || typeof auth.userData !== 'object') return '';

  const record = auth.userData as Record<string, unknown>;
  for (const key of ['boosteroid_auth', 'boosteroidAuth', 'authorization_data', 'authorizationData']) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }

  return '';
}

function upstreamAuthHeaders(auth: UpstreamAuthInput): Record<string, string> {
  const accessToken = getAccessToken(auth);
  const cookieHeader = readCookieAuthToken(accessToken);
  let headers: Record<string, string>;

  if (cookieHeader) {
    const cookies = getCookieAuthCookies(accessToken);
    headers = {
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
  } else {
    headers = { Authorization: normalizeAuthorizationValue(accessToken) };
  }

  if (usesAndroidTVIdentity(auth)) {
    headers = {
      ...androidTvRequestHeaders(),
      ...headers,
      Cookie: appendAndroidTvEntrypointCookie(headers.Cookie),
    };
    const authDataToken = getAuthDataToken(auth);
    if (authDataToken) {
      headers['Authorization-Data'] = authDataToken;
    }
  }

  return headers;
}

async function upstreamGet<T>(auth: UpstreamAuthInput, path: string): Promise<T> {
  const { data } = await upstreamClient.get(path, {
    headers: upstreamAuthHeaders(auth),
  });
  return data as T;
}

async function upstreamPost<T>(auth: UpstreamAuthInput, path: string, body: unknown = {}): Promise<T> {
  const { data } = await upstreamClient.post(path, body, {
    headers: upstreamAuthHeaders(auth),
  });
  return data as T;
}

async function upstreamPatch<T>(auth: UpstreamAuthInput, path: string, body: unknown = {}): Promise<T> {
  const { data } = await upstreamClient.patch(path, body, {
    headers: upstreamAuthHeaders(auth),
  });
  return data as T;
}

async function upstreamDelete<T>(auth: UpstreamAuthInput, path: string): Promise<T> {
  const { data } = await upstreamClient.delete(path, {
    headers: upstreamAuthHeaders(auth),
  });
  return data as T;
}

function appendQuery(pathname: string, query?: Record<string, unknown>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== '') {
          params.append(key, String(item));
        }
      });
      continue;
    }
    params.set(key, String(value));
  }

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

function unwrapArray(data: unknown, keys: string[] = []): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  const record = data as Record<string, unknown>;
  for (const key of ['data', 'applications', 'items', 'results', ...keys]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = unwrapArray(value, keys);
      if (nested.length > 0) return nested;
    }
  }

  return [];
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

export async function getUpstreamUser(auth: UpstreamAuthInput): Promise<Record<string, unknown>> {
  const data = await upstreamGet<unknown>(auth, '/api/v1/user');
  return unwrapRecord(data);
}

export async function getInstalledGamesUpstream(auth: UpstreamAuthInput, query?: Record<string, unknown>): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(auth, appendQuery('/api/v1/boostore/applications/installed', query));
  return unwrapArray(data);
}

export async function getApplicationUpstream(auth: UpstreamAuthInput, appId: number): Promise<Record<string, unknown>> {
  const data = await upstreamGet<unknown>(auth, `/api/v1/boostore/applications/${appId}`);
  return unwrapRecord(data);
}

export async function getBoostoreApplicationsUpstream(auth: UpstreamAuthInput, query?: Record<string, unknown>): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(auth, appendQuery('/api/v1/boostore/applications', query));
  return unwrapArray(data);
}

export async function searchBoostoreApplicationsUpstream(auth: UpstreamAuthInput, query?: Record<string, unknown>): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(auth, appendQuery('/api/v1/boostore/applications/search', query));
  return unwrapArray(data);
}

export async function getNewApplicationsUpstream(auth: UpstreamAuthInput, query?: Record<string, unknown>): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(auth, appendQuery('/api/v1/boostore/applications/new', query));
  return unwrapArray(data);
}

export async function getBoostoreCarouselUpstream(auth: UpstreamAuthInput, query?: Record<string, unknown>): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(auth, appendQuery('/api/v1/boostore/carousel', query));
  return unwrapArray(data, ['slides', 'carousel']);
}

export async function getApplicationCollectionsUpstream(auth: UpstreamAuthInput): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(auth, '/api/v1/boostore/applications/collections');
  return unwrapArray(data);
}

export async function getApplicationGenresUpstream(auth: UpstreamAuthInput): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(auth, '/api/v1/boostore/applications/genres');
  return unwrapArray(data);
}

export async function getApplicationPlatformsUpstream(auth: UpstreamAuthInput): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(auth, '/api/v1/boostore/applications/platforms');
  return unwrapArray(data);
}

export async function getApplicationStoresUpstream(auth: UpstreamAuthInput, store?: string): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(
    auth,
    appendQuery('/api/v1/boostore/applications/stores', store ? { store } : undefined),
  );
  return unwrapArray(data);
}

export async function getApplicationOrderByUpstream(auth: UpstreamAuthInput): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(auth, '/api/v1/boostore/applications/filters/order-by');
  return unwrapArray(data);
}

export async function installApplicationUpstream(auth: UpstreamAuthInput, appId: number): Promise<Record<string, unknown>> {
  const data = await upstreamPatch<unknown>(auth, `/api/v1/boostore/applications/installed/${appId}`, {});
  return unwrapRecord(data);
}

export async function uninstallApplicationUpstream(auth: UpstreamAuthInput, appId: number): Promise<Record<string, unknown>> {
  const data = await upstreamDelete<unknown>(auth, `/api/v1/boostore/applications/installed/${appId}`);
  return unwrapRecord(data);
}

export async function synchronizeInstalledApplicationUpstream(
  auth: UpstreamAuthInput,
  platform: string,
): Promise<Record<string, unknown>> {
  const data = await upstreamPost<unknown>(
    auth,
    `/api/v1/boostore/applications/installed/synchronize/${encodeURIComponent(platform)}`,
    {},
  );
  return unwrapRecord(data);
}

export async function getLastSynchronizeUpstream(auth: UpstreamAuthInput, platform: string): Promise<Record<string, unknown>> {
  const data = await upstreamGet<unknown>(
    auth,
    `/api/v1/boostore/applications/installed/synchronize/${encodeURIComponent(platform)}`,
  );
  return unwrapRecord(data);
}

export async function getActiveSubscriptionsUpstream(auth: UpstreamAuthInput): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(auth, '/api/v1/payments/subscriptions/active');
  return unwrapArray(data, ['subscriptions']);
}

export async function getUserLanguagesUpstream(auth: UpstreamAuthInput): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(auth, '/api/v1/user/languages');
  return unwrapArray(data, ['languages']);
}

export async function getStreamingGatewaysUpstream(auth: UpstreamAuthInput): Promise<unknown[]> {
  const data = await upstreamGet<unknown>(auth, '/api/v1/streaming/gateways');
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown[] }).data)) {
    return (data as { data: unknown[] }).data;
  }
  return [];
}

export async function getStreamingSessionDetailsUpstream(auth: UpstreamAuthInput, sessionId: string): Promise<Record<string, unknown>> {
  const data = await upstreamPost<unknown>(
    auth,
    `/api/v1/streaming/session/details?sessionId=${encodeURIComponent(sessionId)}`,
    null,
  );
  return unwrapRecord(data);
}

export async function enqueueStreamingSessionUpstream(auth: UpstreamAuthInput, appId: number): Promise<Record<string, unknown>> {
  const data = await upstreamPost<unknown>(auth, '/api/v2/streaming/session/enqueue', { appId });
  return unwrapRecord(data);
}

export async function dequeueStreamingSessionUpstream(auth: UpstreamAuthInput): Promise<Record<string, unknown>> {
  const data = await upstreamPost<unknown>(auth, '/api/v2/streaming/session/dequeue', {});
  return unwrapRecord(data);
}

export async function postStreamingSessionLogUpstream(
  auth: UpstreamAuthInput,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const data = await upstreamPost<unknown>(auth, '/api/v1/streaming/session/log', payload);
  return unwrapRecord(data);
}

export async function submitStreamingSessionEvaluationUpstream(
  auth: UpstreamAuthInput,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const data = await upstreamPost<unknown>(auth, '/api/v1/streaming/session/evaluation', payload);
  return unwrapRecord(data);
}

export async function getLastSessionUpstream(auth: UpstreamAuthInput): Promise<Record<string, unknown>> {
  const data = await upstreamGet<unknown>(auth, '/api/v1/streaming/user/last-session');
  return unwrapRecord(data);
}

export async function getLastSessionLiveUpstream(auth: UpstreamAuthInput): Promise<Record<string, unknown>> {
  const data = await upstreamGet<unknown>(auth, '/api/v1/streaming/user/last-session/live');
  return unwrapRecord(data);
}

export async function getActiveSessionsUpstream(auth: UpstreamAuthInput): Promise<Record<string, unknown>> {
  const data = await upstreamGet<unknown>(auth, '/api/v1/streaming/user/active-sessions');
  return unwrapRecord(data);
}

export async function startStreamingSessionV1Upstream(auth: UpstreamAuthInput, appId: number): Promise<Record<string, unknown>> {
  const data = await upstreamPost<unknown>(auth, '/api/v1/streaming/session/start', { appId });
  return unwrapRecord(data);
}

export async function startStreamingSessionV2Upstream(auth: UpstreamAuthInput, appId: number, sessionToken: string): Promise<Record<string, unknown>> {
  const data = await upstreamPost<unknown>(auth, '/api/v2/streaming/session/start', { appId, sessionToken });
  return unwrapRecord(data);
}

export async function logoutUpstream(auth: UpstreamAuthInput): Promise<void> {
  await upstreamClient.post(
    '/api/v2/auth/logout',
    {},
    {
      headers: upstreamAuthHeaders(auth),
    },
  );
}

async function refreshUpstream(session: BridgeSession): Promise<UpstreamTokens> {
  const { data } = await upstreamClient.post(
    '/api/v1/auth/refresh-token',
    {
      refresh_token: session.refreshToken,
    },
    {
      headers: session.usesAndroidTVIdentity
        ? {
            ...androidTvRequestHeaders(),
            Cookie: ANDROID_TV_ENTRYPOINT_COOKIE,
          }
        : undefined,
    },
  );
  const envelope = unwrapRecord(data);

  return {
    access_token: String(envelope.access_token ?? ''),
    refresh_token: String(envelope.refresh_token ?? session.refreshToken),
    user_data: envelope.user_data,
  };
}

async function refreshSession(session: BridgeSession): Promise<BridgeSession> {
  const lockKey = sha256(session.refreshToken);
  let request = refreshRequests.get(lockKey);

  if (!request) {
    request = refreshUpstream(session).finally(() => {
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
  operation: (session: BridgeSession) => Promise<T>,
): Promise<{ session: BridgeSession; result: T }> {
  try {
    return {
      session,
      result: await operation(session),
    };
  } catch (error) {
    const isUnauthorized = error instanceof AxiosError ? error.response?.status === 401 : false;

    if (!isUnauthorized || readCookieAuthToken(session.accessToken)) {
      throw error;
    }

    const refreshedSession = await refreshSession(session);
    const result = await operation(refreshedSession);
    return { session: refreshedSession, result };
  }
}
