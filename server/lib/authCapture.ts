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
const MAX_CAPTURE_FILES = 25;

type CaptureStatus = 'starting' | 'awaiting_user' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
type CaptureTerminalStatus = 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

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
}

interface CaptureRuntime {
  id: string;
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

  async start(): Promise<{ id: string; status: CaptureStatus; timeoutAt: string }> {
    this.cleanupFinishedActive();
    if (this.active && !FINAL_STATUSES.has(this.active.status as CaptureTerminalStatus)) {
      const error = new Error('A login capture is already in progress.');
      (error as Error & { status?: number; details?: unknown }).status = 409;
      (error as Error & { status?: number; details?: unknown }).details = { id: this.active.id, status: this.active.status };
      throw error;
    }

    const now = Date.now();
    const capture: CaptureRuntime = {
      id: randomUUID(),
      status: 'starting',
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
    capture.waitPromise = this.runCapture(capture);
    return { id: capture.id, status: capture.status, timeoutAt: new Date(capture.timeoutAtMs).toISOString() };
  }

  async cancel(id?: string): Promise<CaptureArtifact | null> {
    const capture = this.active;
    if (!capture) return null;
    if (id && capture.id !== id) return null;
    capture.cancelled = true;
    if (!FINAL_STATUSES.has(capture.status as CaptureTerminalStatus)) {
      await this.finalize(capture, 'cancelled', 'Capture cancelled by user.');
    }
    return capture.artifact;
  }

  getStatus(id?: string): CaptureArtifact | null {
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
    if (this.active && FINAL_STATUSES.has(this.active.status as CaptureTerminalStatus)) {
      this.active = null;
    }
  }

  private pushEvent(capture: CaptureRuntime, event: CaptureEvent): void {
    capture.events.push(event);
    capture.updatedAtMs = Date.now();
  }

  private attachNetworkListeners(capture: CaptureRuntime, page: Page): void {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        this.pushEvent(capture, {
          timestamp: new Date().toISOString(),
          type: 'page',
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
        message: error.message,
      });
    });
  }

  private extractTokens(cookies: Cookie[]): { accessToken: string | null; refreshToken: string | null } {
    const accessToken = cookies.find((cookie) => cookie.name === 'access_token')?.value ?? null;
    const refreshToken = cookies.find((cookie) => cookie.name === 'refresh_token')?.value ?? null;
    return { accessToken, refreshToken };
  }

  private async buildBridgeSession(capture: CaptureRuntime): Promise<BridgeSession | null> {
    if (!capture.context || !capture.page) return null;
    const cookies = await capture.context.cookies();
    const { accessToken, refreshToken } = this.extractTokens(cookies);
    if (!accessToken || !refreshToken) return null;

    const user = await getUpstreamUser(accessToken);
    this.pushEvent(capture, {
      timestamp: new Date().toISOString(),
      type: 'note',
      method: 'GET',
      url: `${serverConfig.upstreamBaseUrl}/api/v1/user`,
      status: 200,
      payload: user,
      message: 'Validated captured tokens via upstream user lookup.',
    });

    const loginResponse = capture.events.find((event) => event.type === 'response' && event.url?.includes('/api/v1/auth/login') && event.payload && typeof event.payload === 'object');
    const loginEnvelope = unwrapRecord(loginResponse?.payload);

    return createSession({
      accessToken,
      refreshToken,
      userData: loginEnvelope.user_data,
      user,
    });
  }

  private toArtifact(capture: CaptureRuntime): CaptureArtifact {
    const cookies = capture.artifact?.allCookies ?? [];
    const authCookies = capture.artifact?.authCookies ?? {};
    return {
      id: capture.id,
      status: capture.status,
      startedAt: new Date(capture.startedAtMs).toISOString(),
      updatedAt: new Date(capture.updatedAtMs).toISOString(),
      completedAt: toIso(capture.completedAtMs),
      timeoutAt: new Date(capture.timeoutAtMs).toISOString(),
      loginUrl: LOGIN_URL,
      finalUrl: capture.page?.url() ?? capture.artifact?.finalUrl ?? null,
      upstreamBaseUrl: serverConfig.upstreamBaseUrl,
      errors: [...capture.errors],
      eventCount: capture.events.length,
      authCookies,
      allCookies: cookies,
      observedResponses: capture.events.filter((event) => event.type === 'response' || event.type === 'note'),
      userPayload: (capture.bridgeSession?.user as Record<string, unknown> | undefined) ?? null,
      bridgeSession: capture.bridgeSession,
    };
  }

  private async finalize(capture: CaptureRuntime, status: CaptureStatus, message?: string): Promise<void> {
    if (FINAL_STATUSES.has(capture.status as CaptureTerminalStatus)) return;
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
        message,
      });
    }

    const cookies = capture.context ? await capture.context.cookies() : [];
    const allCookies = cookies.map(serializeCookie);
    const authCookies = Object.fromEntries(
      AUTH_COOKIE_NAMES.map((name) => {
        const found = cookies.find((cookie) => cookie.name === name);
        return [name, found ? serializeCookie(found) : undefined];
      }).filter((entry) => entry[1] !== undefined),
    ) as Partial<Record<(typeof AUTH_COOKIE_NAMES)[number], StoredCookie>>;

    const artifact = this.toArtifact(capture);
    artifact.status = status;
    artifact.completedAt = new Date(capture.completedAtMs).toISOString();
    artifact.updatedAt = new Date(capture.updatedAtMs).toISOString();
    artifact.finalUrl = capture.page?.url() ?? artifact.finalUrl;
    artifact.allCookies = allCookies;
    artifact.authCookies = authCookies;
    artifact.bridgeSession = capture.bridgeSession;
    artifact.userPayload = (capture.bridgeSession?.user as Record<string, unknown> | undefined) ?? null;
    artifact.errors = [...capture.errors];
    artifact.eventCount = capture.events.length;
    artifact.observedResponses = capture.events.filter((event) => event.type === 'response' || event.type === 'note');

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

  private async runCapture(capture: CaptureRuntime): Promise<void> {
    try {
      await ensureArtifactDir();
      const browser = await chromium.launch({
        headless: serverConfig.browserHeadless,
        channel: serverConfig.browserChannel || undefined,
        executablePath: serverConfig.browserExecutablePath || undefined,
        args: serverConfig.browserLaunchArgs,
      });
      const context = await browser.newContext({ viewport: { width: 1400, height: 920 } });
      const page = await context.newPage();
      capture.browser = browser;
      capture.context = context;
      capture.page = page;
      capture.status = 'awaiting_user';
      capture.updatedAtMs = Date.now();
      this.attachNetworkListeners(capture, page);
      this.pushEvent(capture, {
        timestamp: new Date().toISOString(),
        type: 'note',
        message: 'Browser launched. Waiting for manual Boosteroid login.',
      });

      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: serverConfig.browserLaunchNavigateTimeoutMs });

      while (Date.now() < capture.timeoutAtMs) {
        if (capture.cancelled) {
          await this.finalize(capture, 'cancelled', 'Capture cancelled by user.');
          return;
        }

        const bridgeSession = await this.buildBridgeSession(capture).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Waiting for captured upstream session.';
          this.pushEvent(capture, {
            timestamp: new Date().toISOString(),
            type: 'note',
            message,
          });
          return null;
        });

        if (bridgeSession) {
          capture.bridgeSession = bridgeSession;
          await this.finalize(capture, 'succeeded', 'Successfully captured authenticated Boosteroid session.');
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
