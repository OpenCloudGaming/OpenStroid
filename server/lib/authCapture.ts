import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Cookie, type Page } from 'playwright';
import { serverConfig } from '../config.js';
import { createSession, type BridgeSession } from './session.js';
import { getUpstreamUser, unwrapRecord } from './upstream.js';

const LOGIN_URL = 'https://boosteroid.com';
const AUTH_COOKIE_NAMES = ['access_token', 'refresh_token', 'boosteroid_auth', 'qr_auth_code'] as const;
const RELEVANT_PATH_PATTERNS = [
  '/api/v1/auth/login',
  '/api/v1/auth/refresh-token',
  '/api/v2/auth/logout',
  '/api/v1/user',
  '/api/v1/boostore/applications/installed',
  '/auth',
  '/login',
  '/session',
];
const FINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out'] as const);
const DEFAULT_BROWSER_ARGS = [
  '--start-maximized',
  '--window-size=1440,960',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
];
const MAX_CAPTURE_FILES = 25;

type CaptureTerminalStatus = 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
export type CaptureStatus = 'starting' | 'awaiting_user' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
export type CaptureMethod = 'extension' | 'browser';

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
  source?: 'browser' | 'extension';
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
  ingestSource?: 'browser' | 'extension';
  extensionMetadata?: Record<string, unknown>;
}

export interface CaptureStartResult {
  id: string;
  status: CaptureStatus;
  timeoutAt: string;
  captureMethod: CaptureMethod;
  loginUrl: string;
}

export interface ExtensionActiveCapture {
  id: string;
  ingestToken: string;
  timeoutAt: string;
  loginUrl: string;
}

export interface ExtensionCaptureSubmission {
  id: string;
  ingestToken: string;
  finalUrl?: string | null;
  observedResponses?: CaptureEvent[];
  allCookies?: StoredCookie[];
  extensionMetadata?: Record<string, unknown>;
}

interface CaptureRuntime {
  id: string;
  method: CaptureMethod;
  ingestToken: string;
  status: CaptureStatus;
  startedAtMs: number;
  updatedAtMs: number;
  timeoutAtMs: number;
  completedAtMs: number | null;
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
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

function isRelevantUrl(url: string): boolean {
  return RELEVANT_PATH_PATTERNS.some((pattern) => url.includes(pattern));
}

function toIso(ms: number | null): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function summarizeHeaders(headers: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of ['content-type', 'location']) {
    if (headers[key]) picked[key] = headers[key];
  }
  return picked;
}

function serializeCookie(cookie: Cookie): StoredCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  };
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

function dedupeArgs(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter(Boolean))];
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
  return {
    accessToken: typeof envelope.access_token === 'string' && envelope.access_token ? envelope.access_token : null,
    refreshToken: typeof envelope.refresh_token === 'string' && envelope.refresh_token ? envelope.refresh_token : null,
    userData: envelope.user_data,
  };
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

async function ensureArtifactDir(): Promise<void> {
  await fs.mkdir(serverConfig.authCaptureArtifactDir, { recursive: true });
}

async function ensureBrowserProfileDir(): Promise<void> {
  await fs.mkdir(serverConfig.browserUserDataDir, { recursive: true });
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

async function applyStealthDefaults(context: BrowserContext): Promise<void> {
  await context.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });

    if (!('chrome' in window)) {
      Object.defineProperty(window, 'chrome', {
        value: { runtime: {} },
        configurable: true,
      });
    }

    const originalQuery = navigator.permissions && navigator.permissions.query
      ? navigator.permissions.query.bind(navigator.permissions)
      : null;

    if (originalQuery) {
      navigator.permissions.query = (parameters) => (
        parameters && parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters)
      );
    }
  `);
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
      status: method === 'extension' ? 'awaiting_user' : 'starting',
      startedAtMs: now,
      updatedAtMs: now,
      timeoutAtMs: now + serverConfig.browserLoginTimeoutMs,
      completedAtMs: null,
      browser: null,
      context: null,
      page: null,
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
      message: method === 'extension'
        ? 'Waiting for Chrome extension capture from a real user browser session.'
        : 'Launching backend browser capture fallback.',
    });

    if (method === 'browser') {
      capture.waitPromise = this.runBrowserCapture(capture);
    }

    return {
      id: capture.id,
      status: capture.status,
      timeoutAt: new Date(capture.timeoutAtMs).toISOString(),
      captureMethod: capture.method,
      loginUrl: LOGIN_URL,
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

  getActiveExtensionSession(): ExtensionActiveCapture | null {
    this.expireIfTimedOut(this.active);
    const capture = this.active;
    if (!capture || capture.method !== 'extension' || isTerminalStatus(capture.status)) {
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

    capture.events = observedResponses;
    capture.updatedAtMs = Date.now();

    const cookieTokens = extractTokensFromCookies(allCookies);
    const payloadTokens = extractTokensFromEvents(observedResponses);
    const accessToken = cookieTokens.accessToken ?? payloadTokens.accessToken;
    const refreshToken = cookieTokens.refreshToken ?? payloadTokens.refreshToken;

    if (!accessToken || !refreshToken) {
      const artifact = this.buildSubmittedArtifact(capture, submission, allCookies, observedResponses);
      await this.finalize(capture, 'failed', 'Extension capture did not include usable upstream access and refresh tokens.', artifact);
      return capture.artifact as CaptureArtifact;
    }

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
      finalUrl: capture.page?.url() ?? null,
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
      const cookies = capture.context ? (await capture.context.cookies()).map(serializeCookie) : [];
      artifact = this.createBaseArtifact(capture);
      artifact.finalUrl = capture.page?.url() ?? artifact.finalUrl;
      artifact.allCookies = cookies;
      artifact.authCookies = pickAuthCookies(cookies);
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

    await capture.page?.close().catch(() => undefined);
    await capture.context?.close().catch(() => undefined);
    await capture.browser?.close().catch(() => undefined);
    capture.page = null;
    capture.context = null;
    capture.browser = null;
  }

  private attachBrowserNetworkListeners(capture: CaptureRuntime, page: Page): void {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        this.pushEvent(capture, {
          timestamp: new Date().toISOString(),
          type: 'page',
          source: 'browser',
          url: frame.url(),
          message: 'Main frame navigated.',
        });
      }
    });

    page.on('request', (request) => {
      const url = request.url();
      if (!isRelevantUrl(url)) return;
      this.pushEvent(capture, {
        timestamp: new Date().toISOString(),
        type: 'request',
        source: 'browser',
        method: request.method(),
        url,
        message: 'Observed relevant request.',
      });
    });

    page.on('response', async (response) => {
      const url = response.url();
      if (!isRelevantUrl(url)) return;
      const headers = response.headers();
      const event: CaptureEvent = {
        timestamp: new Date().toISOString(),
        type: 'response',
        source: 'browser',
        method: response.request().method(),
        url,
        status: response.status(),
        headers: summarizeHeaders(headers),
        message: 'Observed relevant response.',
      };

      const headerArray = await response.headersArray();
      const setCookieValues = headerArray
        .filter((header) => header.name.toLowerCase() === 'set-cookie')
        .map((header) => header.value);
      if (setCookieValues.length > 0) {
        event.cookieNames = setCookieValues.map((value) => value.split('=')[0] ?? '').filter(Boolean);
      }

      const contentType = headers['content-type'] ?? '';
      if (contentType.includes('application/json')) {
        try {
          event.payload = await response.json();
        } catch {
          event.message = 'Observed relevant response, but JSON payload could not be parsed.';
        }
      }

      this.pushEvent(capture, event);
    });

    page.on('pageerror', (error) => {
      this.pushEvent(capture, {
        timestamp: new Date().toISOString(),
        type: 'error',
        source: 'browser',
        message: error.message,
      });
    });
  }

  private async runBrowserCapture(capture: CaptureRuntime): Promise<void> {
    try {
      await ensureArtifactDir();
      await ensureBrowserProfileDir();

      const context = await chromium.launchPersistentContext(serverConfig.browserUserDataDir, {
        headless: serverConfig.browserHeadless,
        channel: serverConfig.browserChannel || undefined,
        executablePath: serverConfig.browserExecutablePath || undefined,
        locale: serverConfig.browserLocale,
        timezoneId: 'UTC',
        viewport: null,
        ignoreHTTPSErrors: false,
        args: dedupeArgs(DEFAULT_BROWSER_ARGS, serverConfig.browserLaunchArgs),
        ignoreDefaultArgs: ['--enable-automation'],
      });
      await applyStealthDefaults(context);

      const page = context.pages().at(-1) ?? await context.newPage();
      capture.browser = context.browser();
      capture.context = context;
      capture.page = page;
      capture.status = 'awaiting_user';
      capture.updatedAtMs = Date.now();
      this.attachBrowserNetworkListeners(capture, page);
      this.pushEvent(capture, {
        timestamp: new Date().toISOString(),
        type: 'note',
        source: 'browser',
        message: `Browser launched in persistent profile mode using ${serverConfig.browserExecutablePath ?? serverConfig.browserChannel ?? 'default browser'}. Waiting for manual Boosteroid login.`,
      });

      await page.bringToFront().catch(() => undefined);
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: serverConfig.browserLaunchNavigateTimeoutMs });

      while (Date.now() < capture.timeoutAtMs) {
        if (capture.cancelled) {
          await this.finalize(capture, 'cancelled', 'Capture cancelled by user.');
          return;
        }

        const cookies = capture.context ? (await capture.context.cookies()).map(serializeCookie) : [];
        const cookieTokens = extractTokensFromCookies(cookies);
        const payloadTokens = extractTokensFromEvents(capture.events);
        const accessToken = cookieTokens.accessToken ?? payloadTokens.accessToken;
        const refreshToken = cookieTokens.refreshToken ?? payloadTokens.refreshToken;

        if (accessToken && refreshToken) {
          const user = await getUpstreamUser(accessToken);
          capture.bridgeSession = createSession({
            accessToken,
            refreshToken,
            userData: payloadTokens.userData,
            user,
          });
          await this.finalize(capture, 'succeeded', 'Successfully captured authenticated Boosteroid session via backend browser fallback.');
          return;
        }

        await page.waitForTimeout(serverConfig.browserLoginPollIntervalMs);
      }

      await this.finalize(capture, 'timed_out', 'Login capture timed out before an authenticated session was detected.');
    } catch (error) {
      if (capture.cancelled) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unexpected browser capture failure.';
      capture.errors.push(message);
      await this.finalize(capture, 'failed', message);
    }
  }
}

export const authCaptureManager = new AuthCaptureManager();
