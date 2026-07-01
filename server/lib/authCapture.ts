import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { serverConfig } from '../config.js';
import { createSession, type BridgeSession } from './session.js';
import { createCookieAuthToken, getUpstreamUser, restoreCookieAuthToken, unwrapRecord } from './upstream.js';

const LOGIN_URL = 'https://boosteroid.com';
const AUTH_COOKIE_NAMES = ['access_token', 'refresh_token', 'boosteroid_auth', 'qr_auth_code'] as const;
const FINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out'] as const);
const MAX_CAPTURE_FILES = 25;

type CaptureTerminalStatus = 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
export type CaptureStatus = 'starting' | 'awaiting_user' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
export type CaptureMethod = 'extension';

export interface CaptureEvent {
  timestamp: string;
  type: 'page' | 'request' | 'response' | 'note' | 'error';
  method?: string;
  url?: string;
  status?: number;
  payload?: unknown;
  headers?: Record<string, string>;
  cookieNames?: string[];
  message?: string;
  source?: 'extension';
}

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

export interface CaptureArtifact {
  id: string;
  captureMethod: CaptureMethod;
  status: CaptureStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  timeoutAt: string;
  loginUrl: string;
  finalUrl: string | null;
  upstreamBaseUrl: string;
  errors: string[];
  eventCount: number;
  authCookies: Partial<Record<(typeof AUTH_COOKIE_NAMES)[number], StoredCookie>>;
  allCookies: StoredCookie[];
  observedResponses: CaptureEvent[];
  userPayload: Record<string, unknown> | null;
  bridgeSession: BridgeSession | null;
  ingestSource?: 'extension';
  extensionMetadata?: Record<string, unknown>;
  diagnostics?: CaptureDiagnostics;
}

export interface CaptureDiagnostics {
  tokenSource?: 'payload' | 'storage' | 'cookie' | 'none';
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  authCookieNames?: string[];
  storageKeys?: string[];
  relevantResponseSummary?: Array<{
    type: CaptureEvent['type'];
    method?: string;
    url?: string;
    status?: number;
    payloadKeys?: string[];
  }>;
  upstreamValidation?: {
    status?: number;
    message: string;
  };
}

export interface CaptureStartResult {
  id: string;
  status: CaptureStatus;
  timeoutAt: string;
  captureMethod: CaptureMethod;
  loginUrl: string;
  extensionPairingCode?: string;
}

export interface ExtensionActiveCapture {
  id: string;
  ingestToken: string;
  timeoutAt: string;
  loginUrl: string;
}

export interface ExtensionPairingRequest {
  pairingCode: string;
}

export interface ExtensionCaptureSubmission {
  id: string;
  ingestToken: string;
  finalUrl?: string | null;
  observedResponses?: CaptureEvent[];
  allCookies?: StoredCookie[];
  storageItems?: ExtensionStorageItem[];
  extensionMetadata?: Record<string, unknown>;
}

export interface ExtensionStorageItem {
  area: 'localStorage' | 'sessionStorage';
  key: string;
  value: string;
}

interface CaptureRuntime {
  id: string;
  method: CaptureMethod;
  ingestToken: string;
  extensionPairingCode: string | null;
  status: CaptureStatus;
  startedAtMs: number;
  updatedAtMs: number;
  timeoutAtMs: number;
  completedAtMs: number | null;
  events: CaptureEvent[];
  errors: string[];
  bridgeSession: BridgeSession | null;
  artifact: CaptureArtifact | null;
  persistedPath: string | null;
  cancelled: boolean;
  waitPromise: Promise<void> | null;
}

function isTerminalStatus(status: CaptureStatus): boolean {
  return FINAL_STATUSES.has(status as CaptureTerminalStatus);
}

function toIso(ms: number | null): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function normalizeCookie(cookie: Partial<StoredCookie> & Pick<StoredCookie, 'name' | 'value'>): StoredCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain ?? '',
    path: cookie.path ?? '/',
    expires: typeof cookie.expires === 'number' ? cookie.expires : -1,
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
    sameSite: cookie.sameSite ?? 'Lax',
  };
}

function generatePairingCode(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function pickAuthCookies(cookies: StoredCookie[]): Partial<Record<(typeof AUTH_COOKIE_NAMES)[number], StoredCookie>> {
  return Object.fromEntries(
    AUTH_COOKIE_NAMES.map((name) => {
      const found = cookies.find((cookie) => cookie.name === name);
      return [name, found];
    }).filter((entry) => entry[1]),
  ) as Partial<Record<(typeof AUTH_COOKIE_NAMES)[number], StoredCookie>>;
}

function extractTokensFromCookies(cookies: StoredCookie[]): { accessToken: string | null; refreshToken: string | null } {
  return {
    accessToken: cookies.find((cookie) => cookie.name === 'access_token')?.value ?? null,
    refreshToken: cookies.find((cookie) => cookie.name === 'refresh_token')?.value ?? null,
  };
}

function extractTokensFromPayload(payload: unknown): { accessToken: string | null; refreshToken: string | null; userData?: unknown } {
  const envelope = unwrapRecord(payload);
  const recursiveTokens = extractTokensFromRecord(envelope);
  return {
    accessToken: recursiveTokens.accessToken,
    refreshToken: recursiveTokens.refreshToken,
    userData: envelope.user_data,
  };
}

function extractTokensFromRecord(value: unknown, pathParts: string[] = []): { accessToken: string | null; refreshToken: string | null } {
  if (!value || typeof value !== 'object' || pathParts.length > 5) {
    return { accessToken: null, refreshToken: null };
  }

  let accessToken: string | null = null;
  let refreshToken: string | null = null;

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    if (typeof nestedValue === 'string' && nestedValue) {
      if (!accessToken && (
        normalizedKey === 'access_token' ||
        normalizedKey === 'accesstoken' ||
        normalizedKey === 'authorization' ||
        (normalizedKey.includes('access') && normalizedKey.includes('token'))
      )) {
        accessToken = nestedValue;
      }

      if (!refreshToken && (
        normalizedKey === 'refresh_token' ||
        normalizedKey === 'refreshtoken' ||
        (normalizedKey.includes('refresh') && normalizedKey.includes('token'))
      )) {
        refreshToken = nestedValue;
      }
    }

    if ((!accessToken || !refreshToken) && nestedValue && typeof nestedValue === 'object') {
      const nestedTokens = extractTokensFromRecord(nestedValue, [...pathParts, key]);
      accessToken ??= nestedTokens.accessToken;
      refreshToken ??= nestedTokens.refreshToken;
    }
  }

  return { accessToken, refreshToken };
}

function extractTokensFromEvents(events: CaptureEvent[]): { accessToken: string | null; refreshToken: string | null; userData?: unknown } {
  for (const event of events) {
    if (event.type !== 'response' || !event.payload || !event.url || !event.url.includes('/api/v1/auth/login')) {
      continue;
    }
    const extracted = extractTokensFromPayload(event.payload);
    if (extracted.accessToken && extracted.refreshToken) {
      return extracted;
    }
  }

  for (const event of events) {
    if (event.type !== 'response' || !event.payload || !event.url || !event.url.includes('/api/v1/auth/refresh-token')) {
      continue;
    }
    const extracted = extractTokensFromPayload(event.payload);
    if (extracted.accessToken && extracted.refreshToken) {
      return extracted;
    }
  }

  return { accessToken: null, refreshToken: null };
}

function isUserEndpoint(url: string): boolean {
  try {
    return new URL(url, serverConfig.upstreamBaseUrl).pathname === '/api/v1/user';
  } catch {
    return url === '/api/v1/user' || url.endsWith('/api/v1/user');
  }
}

function extractUserFromEvents(events: CaptureEvent[]): Record<string, unknown> | null {
  for (const event of events.slice().reverse()) {
    if (event.type !== 'response' || event.status !== 200 || !event.payload || !event.url || !isUserEndpoint(event.url)) {
      continue;
    }

    const user = unwrapRecord(event.payload);
    if (typeof user.id !== 'undefined' || typeof user.email === 'string') {
      return user;
    }
  }

  return null;
}

function extractUserFromStorage(storageItems: ExtensionStorageItem[]): Record<string, unknown> | null {
  for (const item of storageItems) {
    if (!/user|auth|session/i.test(item.key)) continue;

    try {
      const parsed = JSON.parse(item.value) as unknown;
      const candidate = unwrapRecord(parsed);
      if (typeof candidate.id !== 'undefined' || typeof candidate.email === 'string') {
        return candidate;
      }

      for (const value of Object.values(candidate)) {
        if (!value || typeof value !== 'object') continue;
        const nested = unwrapRecord(value);
        if (typeof nested.id !== 'undefined' || typeof nested.email === 'string') {
          return nested;
        }
      }
    } catch {
      // Not JSON user state.
    }
  }

  return null;
}

function createCookieHeader(cookies: StoredCookie[]): string {
  return cookies
    .filter((cookie) => cookie.name && typeof cookie.value === 'string')
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function restoreArtifactCookieAuthSession(artifact: CaptureArtifact): void {
  const accessToken = artifact.bridgeSession?.accessToken;
  if (!accessToken || artifact.allCookies.length === 0) return;
  restoreCookieAuthToken(accessToken, createCookieHeader(artifact.allCookies), artifact.allCookies);
}

function createCookieSessionUser(observedUser: Record<string, unknown> | null, storageUser: Record<string, unknown> | null): Record<string, unknown> {
  return observedUser ?? storageUser ?? {
    id: 0,
    email: 'boosteroid-cookie-session',
    name: 'Boosteroid cookie session',
  };
}

function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function tokenKeyScore(key: string, tokenKind: 'access' | 'refresh'): number {
  const normalized = key.toLowerCase();
  const hasToken = normalized.includes('token');
  const hasKind = normalized.includes(tokenKind);
  if (hasKind && hasToken) return 3;
  if (hasKind) return 2;
  if (hasToken) return 1;
  return 0;
}

function collectStorageCandidates(key: string, value: unknown, depth = 0): Array<{ key: string; value: string }> {
  if (depth > 4) return [];
  if (typeof value === 'string') return [{ key, value }];
  if (!value || typeof value !== 'object') return [];

  const candidates: Array<{ key: string; value: string }> = [];
  for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    candidates.push(...collectStorageCandidates(`${key}.${nestedKey}`, nestedValue, depth + 1));
  }
  return candidates;
}

function extractTokensFromStorage(storageItems: ExtensionStorageItem[]): { accessToken: string | null; refreshToken: string | null } {
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let accessScore = 0;
  let refreshScore = 0;

  for (const item of storageItems) {
    const candidates = [{ key: item.key, value: item.value }];
    try {
      const parsed = JSON.parse(item.value) as unknown;
      candidates.push(...collectStorageCandidates(item.key, parsed));
    } catch {
      // Plain storage value.
    }

    for (const { key, value } of candidates) {
      if (!value) continue;

      const accessCandidateScore = tokenKeyScore(key, 'access');
      if (accessCandidateScore > accessScore && looksLikeJwt(value)) {
        accessToken = value;
        accessScore = accessCandidateScore;
      }

      const refreshCandidateScore = tokenKeyScore(key, 'refresh');
      if (refreshCandidateScore > refreshScore) {
        refreshToken = value;
        refreshScore = refreshCandidateScore;
      }
    }
  }

  return { accessToken, refreshToken };
}

function payloadKeys(payload: unknown): string[] {
  const envelope = unwrapRecord(payload);
  return Object.keys(envelope).slice(0, 20);
}

function createDiagnostics(
  observedResponses: CaptureEvent[],
  allCookies: StoredCookie[],
  storageItems: ExtensionStorageItem[],
  tokenSource: CaptureDiagnostics['tokenSource'],
  accessToken: string | null,
  refreshToken: string | null,
  upstreamValidation?: CaptureDiagnostics['upstreamValidation'],
): CaptureDiagnostics {
  return {
    tokenSource,
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
    authCookieNames: allCookies
      .filter((cookie) => AUTH_COOKIE_NAMES.includes(cookie.name as (typeof AUTH_COOKIE_NAMES)[number]))
      .map((cookie) => `${cookie.domain}:${cookie.name}`),
    storageKeys: storageItems.map((item) => `${item.area}:${item.key}`).slice(0, 25),
    relevantResponseSummary: observedResponses.slice(-25).map((event) => ({
      type: event.type,
      method: event.method,
      url: event.url,
      status: event.status,
      payloadKeys: event.payload ? payloadKeys(event.payload) : undefined,
    })),
    upstreamValidation,
  };
}

async function ensureArtifactDir(): Promise<void> {
  await fs.mkdir(serverConfig.authCaptureArtifactDir, { recursive: true });
}

async function pruneArtifacts(): Promise<void> {
  const entries = await fs.readdir(serverConfig.authCaptureArtifactDir, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map(async (entry) => {
    const filePath = path.join(serverConfig.authCaptureArtifactDir, entry.name);
    const stat = await fs.stat(filePath);
    return { filePath, mtimeMs: stat.mtimeMs };
  }));
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  await Promise.all(files.slice(MAX_CAPTURE_FILES).map((file) => fs.unlink(file.filePath).catch(() => undefined)));
}

async function persistArtifact(artifact: CaptureArtifact): Promise<string> {
  await ensureArtifactDir();
  const filePath = path.join(serverConfig.authCaptureArtifactDir, `${artifact.startedAt.replace(/[:.]/g, '-')}-${artifact.id}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await pruneArtifacts();
  return filePath;
}

class AuthCaptureManager {
  private active: CaptureRuntime | null = null;
  private latestArtifact: CaptureArtifact | null = null;
  private latestArtifactPath: string | null = null;

  constructor() {
    void this.restoreLatestArtifact().catch(() => undefined);
  }

  async start(method: CaptureMethod = 'extension'): Promise<CaptureStartResult> {
    this.cleanupFinishedActive();
    if (this.active && !isTerminalStatus(this.active.status)) {
      const error = new Error('A login capture is already in progress.');
      (error as Error & { status?: number; details?: unknown }).status = 409;
      (error as Error & { status?: number; details?: unknown }).details = { id: this.active.id, status: this.active.status, captureMethod: this.active.method };
      throw error;
    }

    const now = Date.now();
    const capture: CaptureRuntime = {
      id: randomUUID(),
      method,
      ingestToken: randomUUID(),
      extensionPairingCode: generatePairingCode(),
      status: 'awaiting_user',
      startedAtMs: now,
      updatedAtMs: now,
      timeoutAtMs: now + serverConfig.authCaptureTimeoutMs,
      completedAtMs: null,
      events: [],
      errors: [],
      bridgeSession: null,
      artifact: null,
      persistedPath: null,
      cancelled: false,
      waitPromise: null,
    };

    this.active = capture;
    this.pushEvent(capture, {
      timestamp: new Date().toISOString(),
      type: 'note',
      source: method,
      message: 'Waiting for Chrome extension capture from a real user browser session.',
    });

    return {
      id: capture.id,
      status: capture.status,
      timeoutAt: new Date(capture.timeoutAtMs).toISOString(),
      captureMethod: capture.method,
      loginUrl: LOGIN_URL,
      extensionPairingCode: capture.extensionPairingCode ?? undefined,
    };
  }

  async cancel(id?: string): Promise<CaptureArtifact | null> {
    const capture = this.active;
    if (!capture) return null;
    if (id && capture.id !== id) return null;
    capture.cancelled = true;
    if (!isTerminalStatus(capture.status)) {
      await this.finalize(capture, 'cancelled', 'Capture cancelled by user.');
    }
    return capture.artifact;
  }

  getStatus(id?: string): CaptureArtifact | null {
    this.expireIfTimedOut(this.active);
    const current = this.active;
    if (current && (!id || current.id === id)) {
      return this.toArtifact(current);
    }
    if (this.latestArtifact && (!id || this.latestArtifact.id === id)) {
      return this.latestArtifact;
    }
    return null;
  }

  getLatestArtifact(): { artifact: CaptureArtifact | null; path: string | null } {
    return { artifact: this.latestArtifact, path: this.latestArtifactPath };
  }

  getActiveExtensionSession(pairingCode: string): ExtensionActiveCapture | null {
    this.expireIfTimedOut(this.active);
    const capture = this.active;
    if (!capture || capture.method !== 'extension' || isTerminalStatus(capture.status)) {
      return null;
    }

    if (!capture.extensionPairingCode || capture.extensionPairingCode !== pairingCode.trim().toUpperCase()) {
      return null;
    }

    return {
      id: capture.id,
      ingestToken: capture.ingestToken,
      timeoutAt: new Date(capture.timeoutAtMs).toISOString(),
      loginUrl: LOGIN_URL,
    };
  }

  async ingestExtensionCapture(submission: ExtensionCaptureSubmission): Promise<CaptureArtifact> {
    this.expireIfTimedOut(this.active);
    const capture = this.active;
    if (!capture || capture.method !== 'extension' || capture.id !== submission.id) {
      const error = new Error('No matching extension capture session found.');
      (error as Error & { status?: number }).status = 404;
      throw error;
    }

    if (capture.ingestToken !== submission.ingestToken) {
      const error = new Error('Invalid extension capture token.');
      (error as Error & { status?: number }).status = 403;
      throw error;
    }

    const allCookies = Array.isArray(submission.allCookies)
      ? submission.allCookies.map((cookie) => normalizeCookie(cookie))
      : [];
    const observedResponses = Array.isArray(submission.observedResponses)
      ? submission.observedResponses
          .filter((event) => event && typeof event === 'object')
          .map((event): CaptureEvent => ({
            ...event,
            source: 'extension',
          }))
      : [];
    const storageItems = Array.isArray(submission.storageItems)
      ? submission.storageItems
          .filter((item): item is ExtensionStorageItem => (
            item &&
            typeof item === 'object' &&
            (item.area === 'localStorage' || item.area === 'sessionStorage') &&
            typeof item.key === 'string' &&
            typeof item.value === 'string'
          ))
      : [];

    capture.events = observedResponses;
    capture.updatedAtMs = Date.now();

    const cookieTokens = extractTokensFromCookies(allCookies);
    const payloadTokens = extractTokensFromEvents(observedResponses);
    const storageTokens = extractTokensFromStorage(storageItems);
    const accessToken = payloadTokens.accessToken ?? storageTokens.accessToken ?? cookieTokens.accessToken;
    const refreshToken = payloadTokens.refreshToken ?? storageTokens.refreshToken ?? cookieTokens.refreshToken;
    const tokenSource: CaptureDiagnostics['tokenSource'] =
      payloadTokens.accessToken || payloadTokens.refreshToken
        ? 'payload'
        : storageTokens.accessToken || storageTokens.refreshToken
          ? 'storage'
          : cookieTokens.accessToken || cookieTokens.refreshToken
            ? 'cookie'
            : 'none';
    const observedUser = extractUserFromEvents(observedResponses);
    const storageUser = extractUserFromStorage(storageItems);
    const cookieHeader = createCookieHeader(allCookies);

    if (cookieTokens.accessToken && cookieTokens.refreshToken && cookieHeader) {
      const sessionUser = createCookieSessionUser(observedUser, storageUser);
      const cookieAuthToken = createCookieAuthToken(cookieHeader, allCookies);
      capture.bridgeSession = createSession({
        accessToken: cookieAuthToken,
        refreshToken: refreshToken ?? cookieAuthToken,
        userData: payloadTokens.userData,
        user: sessionUser,
      });

      const artifact = this.buildSubmittedArtifact(capture, submission, allCookies, observedResponses);
      artifact.diagnostics = createDiagnostics(observedResponses, allCookies, storageItems, 'cookie', accessToken, refreshToken, {
        status: observedUser ? 200 : undefined,
        message: observedUser
          ? 'Accepted captured Boosteroid cookies with observed /api/v1/user response.'
          : 'Accepted captured Boosteroid auth cookies without blocking on server-side token validation.',
      });

      await this.finalize(capture, 'succeeded', 'Successfully captured authenticated Boosteroid session via Chrome extension cookies.', artifact);
      return capture.artifact as CaptureArtifact;
    }

    if (!accessToken || !refreshToken) {
      const artifact = this.buildSubmittedArtifact(capture, submission, allCookies, observedResponses);
      artifact.diagnostics = createDiagnostics(observedResponses, allCookies, storageItems, tokenSource, accessToken, refreshToken);
      this.keepExtensionCaptureWaiting(capture, 'Extension capture did not include usable upstream access and refresh tokens.', artifact);
      return capture.artifact ?? artifact;
    }

    try {
      const user = await getUpstreamUser(accessToken);
      capture.bridgeSession = createSession({
        accessToken,
        refreshToken,
        userData: payloadTokens.userData,
        user,
      });

      const artifact = this.buildSubmittedArtifact(capture, submission, allCookies, [
        ...observedResponses,
        {
          timestamp: new Date().toISOString(),
          type: 'note',
          source: 'extension',
          method: 'GET',
          url: `${serverConfig.upstreamBaseUrl}/api/v1/user`,
          status: 200,
          payload: user,
          message: 'Validated extension-captured tokens via upstream user lookup.',
        },
      ]);

      await this.finalize(capture, 'succeeded', 'Successfully captured authenticated Boosteroid session via Chrome extension.', artifact);
      return capture.artifact as CaptureArtifact;
    } catch (error) {
      const artifact = this.buildSubmittedArtifact(capture, submission, allCookies, observedResponses);
      const message = error instanceof Error ? `Extension capture token validation failed: ${error.message}` : 'Extension capture token validation failed.';
      artifact.diagnostics = createDiagnostics(observedResponses, allCookies, storageItems, tokenSource, accessToken, refreshToken, {
        status: error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { status?: number } }).response?.status
          : undefined,
        message,
      });
      this.keepExtensionCaptureWaiting(capture, message, artifact);
      return capture.artifact ?? artifact;
    }
  }

  private expireIfTimedOut(capture: CaptureRuntime | null): void {
    if (!capture || isTerminalStatus(capture.status) || Date.now() <= capture.timeoutAtMs) {
      return;
    }

    void this.finalize(capture, 'timed_out', 'Login capture timed out before an authenticated session was detected.');
  }

  private async restoreLatestArtifact(): Promise<void> {
    await ensureArtifactDir();
    const entries = await fs.readdir(serverConfig.authCaptureArtifactDir, { withFileTypes: true }).catch(() => []);
    const files = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map(async (entry) => {
      const filePath = path.join(serverConfig.authCaptureArtifactDir, entry.name);
      const stat = await fs.stat(filePath);
      return { filePath, mtimeMs: stat.mtimeMs };
    }));
    const latest = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (!latest) return;
    const raw = await fs.readFile(latest.filePath, 'utf8').catch(() => null);
    if (!raw) return;
    this.latestArtifact = JSON.parse(raw) as CaptureArtifact;
    this.latestArtifactPath = latest.filePath;
    restoreArtifactCookieAuthSession(this.latestArtifact);
  }

  private cleanupFinishedActive(): void {
    if (this.active && isTerminalStatus(this.active.status)) {
      this.active = null;
    }
  }

  private pushEvent(capture: CaptureRuntime, event: CaptureEvent): void {
    capture.events.push(event);
    capture.updatedAtMs = Date.now();
  }

  private keepExtensionCaptureWaiting(capture: CaptureRuntime, message: string, artifact: CaptureArtifact): void {
    capture.status = 'awaiting_user';
    capture.updatedAtMs = Date.now();
    if (capture.errors.at(-1) !== message) {
      capture.errors.push(message);
    }
    this.pushEvent(capture, {
      timestamp: new Date().toISOString(),
      type: 'error',
      source: 'extension',
      message,
    });

    artifact.status = capture.status;
    artifact.updatedAt = new Date(capture.updatedAtMs).toISOString();
    artifact.completedAt = null;
    artifact.errors = [...capture.errors];
    artifact.bridgeSession = null;
    artifact.userPayload = null;
    artifact.eventCount = capture.events.length;
    capture.artifact = artifact;
  }

  private createBaseArtifact(capture: CaptureRuntime): CaptureArtifact {
    return {
      id: capture.id,
      captureMethod: capture.method,
      status: capture.status,
      startedAt: new Date(capture.startedAtMs).toISOString(),
      updatedAt: new Date(capture.updatedAtMs).toISOString(),
      completedAt: toIso(capture.completedAtMs),
      timeoutAt: new Date(capture.timeoutAtMs).toISOString(),
      loginUrl: LOGIN_URL,
      finalUrl: null,
      upstreamBaseUrl: serverConfig.upstreamBaseUrl,
      errors: [...capture.errors],
      eventCount: capture.events.length,
      authCookies: {},
      allCookies: [],
      observedResponses: capture.events.filter((event) => event.type === 'response' || event.type === 'note'),
      userPayload: (capture.bridgeSession?.user as Record<string, unknown> | undefined) ?? null,
      bridgeSession: capture.bridgeSession,
      ingestSource: capture.method,
    };
  }

  private buildSubmittedArtifact(
    capture: CaptureRuntime,
    submission: ExtensionCaptureSubmission,
    allCookies: StoredCookie[],
    observedResponses: CaptureEvent[],
  ): CaptureArtifact {
    const artifact = this.createBaseArtifact(capture);
    artifact.finalUrl = submission.finalUrl ?? artifact.finalUrl;
    artifact.allCookies = allCookies;
    artifact.authCookies = pickAuthCookies(allCookies);
    artifact.observedResponses = observedResponses;
    artifact.eventCount = observedResponses.length;
    artifact.extensionMetadata = submission.extensionMetadata ?? undefined;
    artifact.ingestSource = 'extension';
    artifact.userPayload = (capture.bridgeSession?.user as Record<string, unknown> | undefined) ?? null;
    artifact.bridgeSession = capture.bridgeSession;
    artifact.errors = [...capture.errors];
    return artifact;
  }

  private toArtifact(capture: CaptureRuntime): CaptureArtifact {
    return capture.artifact ?? this.createBaseArtifact(capture);
  }

  private async finalize(capture: CaptureRuntime, status: CaptureStatus, message?: string, artifactOverride?: CaptureArtifact): Promise<void> {
    if (isTerminalStatus(capture.status)) return;
    capture.status = status;
    capture.updatedAtMs = Date.now();
    capture.completedAtMs = Date.now();
    if (message) {
      if (status !== 'succeeded') {
        capture.errors.push(message);
      }
      this.pushEvent(capture, {
        timestamp: new Date().toISOString(),
        type: status === 'succeeded' ? 'note' : 'error',
        source: capture.method,
        message,
      });
    }

    let artifact = artifactOverride;
    if (!artifact) {
      artifact = this.createBaseArtifact(capture);
      artifact.eventCount = capture.events.length;
      artifact.observedResponses = capture.events.filter((event) => event.type === 'response' || event.type === 'note');
      artifact.userPayload = (capture.bridgeSession?.user as Record<string, unknown> | undefined) ?? null;
      artifact.bridgeSession = capture.bridgeSession;
    }

    artifact.status = status;
    artifact.updatedAt = new Date(capture.updatedAtMs).toISOString();
    artifact.completedAt = new Date(capture.completedAtMs).toISOString();
    artifact.errors = [...capture.errors];
    artifact.captureMethod = capture.method;
    artifact.bridgeSession = capture.bridgeSession;
    artifact.userPayload = (capture.bridgeSession?.user as Record<string, unknown> | undefined) ?? null;

    capture.artifact = artifact;
    capture.persistedPath = await persistArtifact(artifact);
    this.latestArtifact = artifact;
    this.latestArtifactPath = capture.persistedPath;
  }
}

export const authCaptureManager = new AuthCaptureManager();
