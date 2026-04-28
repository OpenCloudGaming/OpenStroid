import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { serverConfig } from './config.js';
import {
  authCaptureManager,
  type CaptureMethod,
  type ExtensionPairingRequest,
} from './lib/authCapture.js';
import { clearSession, createSession, readSession, writeSession } from './lib/session.js';
import {
  dequeueStreamingSessionUpstream,
  enqueueStreamingSessionUpstream,
  getActiveSessionsUpstream,
  getApplicationUpstream,
  getCookieAuthCookies,
  getInstalledGamesUpstream,
  getLastSessionLiveUpstream,
  getLastSessionUpstream,
  getStreamingGatewaysUpstream,
  getStreamingSessionDetailsUpstream,
  getUpstreamUser,
  isCookieAuthToken,
  logoutUpstream,
  normalizeError,
  startStreamingSessionV1Upstream,
  startStreamingSessionV2Upstream,
  withRefresh,
} from './lib/upstream.js';
import type { BridgeSession } from './lib/session.js';

interface StreamLaunchResult {
  appId: number;
  app: Record<string, unknown> | null;
  sessionId: string;
  streamingUrl: string;
  gateways: unknown[];
  streamClientConfig: {
    homeUrl: string;
    sessionId: string;
    sessionQueries: string[];
    gateways: unknown[];
    accessToken: string;
    authDataToken: string;
    preferredCodec: 'auto';
  };
  localStorage: Record<string, unknown>;
  cookies: ReturnType<typeof getCookieAuthCookies>;
  startPayload: Record<string, unknown>;
  sessionDetails?: Record<string, unknown> | null;
  launchDiagnostics?: Record<string, unknown>;
}

interface SessionEntry {
  sessionId: string;
  status: string;
  appId: string;
}

interface SessionSignals {
  sessionTokens: string[];
  sessionQueries: string[];
  queuedSessionIds: string[];
  payloads: Array<{ source: string; payload: Record<string, unknown> }>;
}

interface RealtimeQueueListener {
  ready: Promise<void>;
  payloads(): Array<{ source: string; payload: Record<string, unknown> }>;
  close(): void;
}

export function createBridgeApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    const origin = req.header('origin');
    if (origin?.startsWith('chrome-extension://')) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
    } else if (serverConfig.appOrigin) {
      res.header('Access-Control-Allow-Origin', serverConfig.appOrigin);
      res.header('Vary', 'Origin');
    }

    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  });

  function sendSession(res: Response, user: Record<string, unknown> | null) {
    res.json({
      authenticated: Boolean(user),
      user,
    });
  }

  function requireSession(req: Request, res: Response) {
    const session = readSession(req);
    if (!session) {
      clearSession(res);
      res.status(401).json({ message: 'Authentication required.' });
      return null;
    }
    return session;
  }

  function findNestedString(value: unknown, keys: string[], depth = 0): string | null {
    if (!value || typeof value !== 'object' || depth > 5) return null;

    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (keys.includes(key) && typeof nestedValue === 'string' && nestedValue) {
        return nestedValue;
      }
    }

    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      const found = findNestedString(nestedValue, keys, depth + 1);
      if (found) return found;
    }

    return null;
  }

  function walk(value: unknown, visit: (leaf: unknown, key: string) => void, key = '') {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, visit, key));
      return;
    }
    if (typeof value === 'object') {
      for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
        walk(entryValue, visit, entryKey);
      }
      return;
    }
    visit(value, key);
  }

  function uniq<T>(values: T[]): T[] {
    return [...new Set(values)];
  }

  function findNestedGateways(value: unknown, keys: string[], depth = 0): unknown[] {
    if (!value || typeof value !== 'object' || depth > 5) return [];

    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (keys.includes(key)) {
        if (Array.isArray(nestedValue)) return nestedValue;
        if (nestedValue && typeof nestedValue === 'object') return [nestedValue];
        if (typeof nestedValue === 'string' && nestedValue) return [nestedValue];
      }
    }

    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      const found = findNestedGateways(nestedValue, keys, depth + 1);
      if (found.length > 0) return found;
    }

    return [];
  }

  function extractSessionIdFromUrl(url: string): string | null {
    try {
      return new URL(url, serverConfig.upstreamBaseUrl).searchParams.get('sessionId');
    } catch {
      return null;
    }
  }

  function extractErrorCode(error: unknown): number | null {
    const normalized = normalizeError(error);
    const text = `${normalized.message} ${JSON.stringify(normalized.details ?? '')}`;
    const match = text.match(/"?error_code"?\s*:?\s*(\d{4,})/);
    return match ? Number(match[1]) : null;
  }

  function normalizeStatus(value: unknown): string {
    return String(value ?? '').trim().toUpperCase();
  }

  function isUuidLike(value: unknown): value is string {
    return typeof value === 'string' &&
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(value);
  }

  function isNotReadySessionStatus(status: unknown): boolean {
    const value = normalizeStatus(status);
    if (!value) return false;

    return new Set([
      'EN',
      'QUEUE',
      'QUEUED',
      'WAIT',
      'WAITING',
      'PENDING',
      'INIT',
      'INITIALIZING',
      'STARTING',
      'CREATING',
      'NEW',
      'END',
      'ENDED',
      'FINISHED',
      'TERMINATED',
      'TIMEOUT',
      'EXPIRED',
      'FAILED',
      'ERROR',
      'CANCELLED',
      'CANCELED',
      'CLOSED',
    ]).has(value);
  }

  function normalizeQueryCandidate(value: unknown): string {
    const str = String(value ?? '').trim();
    if (!str) return '';
    if (str.startsWith('?')) return str;
    if (str.includes('?')) return str.slice(str.indexOf('?'));
    if (str.includes('=')) return `?${str}`;
    return '';
  }

  function getSessionIdFromQuery(query: unknown): string | null {
    const normalized = normalizeQueryCandidate(query);
    if (!normalized) return null;
    const params = new URLSearchParams(normalized.replace(/^\?/, ''));
    return params.get('sessionId') ?? params.get('sessionid') ?? params.get('session');
  }

  function extractSessionTokens(payload: unknown): string[] {
    const tokens: string[] = [];
    walk(payload, (leaf, key) => {
      if (typeof leaf !== 'string' || !/^(session)?token$/i.test(key)) return;
      const token = leaf.trim();
      if (token.length >= 8) tokens.push(token);
    });
    return uniq(tokens);
  }

  function extractSessionQueries(payload: unknown): string[] {
    const queries: string[] = [];
    walk(payload, (leaf) => {
      if (typeof leaf !== 'string') return;
      const query = normalizeQueryCandidate(leaf);
      if (query && getSessionIdFromQuery(query)) queries.push(query);
    });
    return uniq(queries);
  }

  function extractSessionEntries(payload: unknown): SessionEntry[] {
    const entries: SessionEntry[] = [];

    function visit(value: unknown) {
      if (value == null) return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (typeof value !== 'object') return;

      const record = value as Record<string, unknown>;
      const sessionIds = [record.sessionId, record.sessionID, record.sid].filter(isUuidLike);
      if (sessionIds.length > 0) {
        const appId = record.appId ?? record.applicationId ?? record.gameId ?? '';
        const status = record.status ?? record.sessionStatus ?? record.state ?? record.stage ?? '';
        sessionIds.forEach((sessionId) => {
          entries.push({
            sessionId: sessionId.trim(),
            status: normalizeStatus(status),
            appId: appId == null || appId === '' ? '' : String(appId).trim(),
          });
        });
      }

      Object.values(record).forEach(visit);
    }

    visit(payload);
    return entries;
  }

  function collectSessionSignals(appId: number, payloads: Array<{ source: string; payload: Record<string, unknown> }>): SessionSignals {
    const appIdText = String(appId);
    const sessionTokens: string[] = [];
    const sessionQueries: string[] = [];
    const queuedSessionIds: string[] = [];
    const blockedSessionIds = new Set<string>();

    for (const { payload } of payloads) {
      extractSessionEntries(payload).forEach((entry) => {
        if (entry.appId && entry.appId !== appIdText) return;
        if (isNotReadySessionStatus(entry.status)) {
          queuedSessionIds.push(entry.sessionId);
          blockedSessionIds.add(entry.sessionId);
          return;
        }
        sessionQueries.push(`?sessionId=${entry.sessionId}`);
      });

      sessionTokens.push(...extractSessionTokens(payload));
      sessionQueries.push(...extractSessionQueries(payload));
    }

    return {
      sessionTokens: uniq(sessionTokens),
      sessionQueries: uniq(sessionQueries).filter((query) => {
        const sessionId = getSessionIdFromQuery(query);
        return !sessionId || !blockedSessionIds.has(sessionId);
      }),
      queuedSessionIds: uniq(queuedSessionIds),
      payloads,
    };
  }

  async function optionalPayload(source: string, request: () => Promise<Record<string, unknown>>) {
    try {
      return { source, payload: await request() };
    } catch {
      return null;
    }
  }

  function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getSessionUserId(session: BridgeSession): string | null {
    const id = session.user?.id;
    return id === undefined || id === null ? null : String(id);
  }

  function getRealtimeAccessToken(accessToken: string): string {
    return getCookieAuthCookies(accessToken).find((cookie) => cookie.name === 'access_token')?.value ?? accessToken;
  }

  function getStreamClientAuth(accessToken: string): { accessToken: string; authDataToken: string } {
    const cookies = getCookieAuthCookies(accessToken);
    const accessCookie = cookies.find((cookie) => cookie.name === 'access_token')?.value ?? accessToken;
    const authDataToken = cookies.find((cookie) => cookie.name === 'boosteroid_auth')?.value ?? '';
    return {
      accessToken: normalizeAuthorizationForClient(accessCookie),
      authDataToken,
    };
  }

  function normalizeAuthorizationForClient(accessToken: string): string {
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

  function createRealtimeQueueListener(session: BridgeSession): RealtimeQueueListener | null {
    const WebSocketClient = globalThis.WebSocket as (new (url: string) => {
      readyState: number;
      send(data: string): void;
      close(code?: number, reason?: string): void;
      addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void;
    }) | undefined;

    const userId = getSessionUserId(session);
    const token = getRealtimeAccessToken(session.accessToken);
    if (!WebSocketClient || !userId || !token) {
      return null;
    }

    const url = new URL('/ws', serverConfig.upstreamBaseUrl);
    url.protocol = 'wss:';
    url.searchParams.set('uid', userId);
    url.searchParams.set('token', token);

    const socket = new WebSocketClient(url.toString());
    const messages: Record<string, unknown>[] = [];
    let pingTimer: NodeJS.Timeout | null = null;
    let settled = false;
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const settleReady = () => {
      if (settled) return;
      settled = true;
      resolveReady();
    };

    socket.addEventListener('open', () => {
      settleReady();
      pingTimer = setInterval(() => {
        try {
          socket.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // The REST poller remains active if realtime pings fail.
        }
      }, 5000);
    });

    socket.addEventListener('message', (event: unknown) => {
      const data = (event as { data?: unknown }).data;
      try {
        const parsed = JSON.parse(String(data)) as unknown;
        if (parsed && typeof parsed === 'object') {
          messages.push(parsed as Record<string, unknown>);
        }
      } catch {
        // Ignore non-JSON realtime frames.
      }
    });

    socket.addEventListener('close', settleReady);
    socket.addEventListener('error', settleReady);

    return {
      ready,
      payloads: () => messages.map((payload, index) => ({
        source: `websocket:${index}`,
        payload,
      })),
      close: () => {
        if (pingTimer) clearInterval(pingTimer);
        try {
          socket.close(1000, 'launch-complete');
        } catch {
          // Socket may already be closed.
        }
      },
    };
  }

  async function discoverSessionSignals(
    accessToken: string,
    appId: number,
    seedPayload: Record<string, unknown>,
    realtimePayloads: Array<{ source: string; payload: Record<string, unknown> }> = [],
  ): Promise<SessionSignals> {
    const payloads = [
      { source: 'enqueue', payload: seedPayload },
      ...realtimePayloads,
      await optionalPayload('last-session/live', () => getLastSessionLiveUpstream(accessToken)),
      await optionalPayload('last-session', () => getLastSessionUpstream(accessToken)),
      await optionalPayload('active-sessions', () => getActiveSessionsUpstream(accessToken)),
    ].filter((item): item is { source: string; payload: Record<string, unknown> } => Boolean(item));

    return collectSessionSignals(appId, payloads);
  }

  async function waitForStartableSession(
    accessToken: string,
    appId: number,
    enqueuePayload: Record<string, unknown>,
    realtimePayloads: () => Array<{ source: string; payload: Record<string, unknown> }> = () => [],
  ): Promise<SessionSignals> {
    const deadline = Date.now() + 180_000;
    let bestSignals = collectSessionSignals(appId, [{ source: 'enqueue', payload: enqueuePayload }]);

    await delay(5_000);

    while (Date.now() < deadline) {
      const signals = await discoverSessionSignals(accessToken, appId, enqueuePayload, realtimePayloads());
      if (signals.sessionTokens.length > 0 || signals.sessionQueries.some((query) => getSessionIdFromQuery(query))) {
        return signals;
      }
      if (signals.queuedSessionIds.length > 0) {
        bestSignals = signals;
      }
      await delay(2_000);
    }

    return bestSignals;
  }

  async function waitForStreamingSessionDetails(accessToken: string, sessionId: string): Promise<Record<string, unknown> | null> {
    const deadline = Date.now() + 60_000;
    let latest: Record<string, unknown> | null = null;

    while (Date.now() < deadline) {
      try {
        latest = await getStreamingSessionDetailsUpstream(accessToken, sessionId);
        if (findNestedString(latest, ['queryString', 'query', 'sessionQuery'])) {
          return latest;
        }
      } catch {
        // Details can lag behind the VM-ready signal briefly.
      }
      await delay(2_000);
    }

    return latest;
  }

  function createStreamingUrl(sessionId: string, startUrl?: string | null): string {
    if (startUrl) {
      try {
        const parsed = new URL(startUrl, serverConfig.upstreamBaseUrl);
        if (parsed.searchParams.get('sessionId')) {
          return parsed.toString();
        }
      } catch {
        // Fall back to the known official streaming entry point.
      }
    }

    const url = new URL('/static/streaming/streaming.html', serverConfig.upstreamBaseUrl);
    url.searchParams.set('sessionId', sessionId);
    return url.toString();
  }

  function streamingUrlToQuery(streamingUrl: string): string | null {
    try {
      const parsed = new URL(streamingUrl, serverConfig.upstreamBaseUrl);
      return parsed.search || null;
    } catch {
      return null;
    }
  }

  function hasFallbackStartCode(error: unknown): boolean {
    return extractErrorCode(error) === 340006;
  }

  async function launchStreamingSession(session: BridgeSession, appId: number): Promise<StreamLaunchResult> {
    const accessToken = session.accessToken;
    const appDetails = await getApplicationUpstream(accessToken, appId).catch(() => null);
    let gateways: unknown[] = [];
    let startPayload: Record<string, unknown> | null = null;
    let startUrl: string | null = null;

    let launchDiagnostics: Record<string, unknown> | undefined;
    let useV1Fallback = false;
    const realtimeListener = createRealtimeQueueListener(session);

    try {
      await Promise.race([realtimeListener?.ready ?? Promise.resolve(), delay(3000)]);
      const enqueuePayload = await enqueueStreamingSessionUpstream(accessToken, appId);
      const signals = await waitForStartableSession(
        accessToken,
        appId,
        enqueuePayload,
        () => realtimeListener?.payloads() ?? [],
      );
      launchDiagnostics = {
        signalSources: signals.payloads.map((payload) => payload.source),
        queuedSessionIds: signals.queuedSessionIds,
        sessionTokenCount: signals.sessionTokens.length,
        sessionQueryCount: signals.sessionQueries.length,
      };

      for (const sessionToken of signals.sessionTokens) {
        try {
          startPayload = await startStreamingSessionV2Upstream(accessToken, appId, sessionToken);
          break;
        } catch (error) {
          const errorCode = extractErrorCode(error);
          if (errorCode === 340005) {
            await dequeueStreamingSessionUpstream(accessToken).catch(() => ({}));
            const nextEnqueuePayload = await enqueueStreamingSessionUpstream(accessToken, appId);
            const nextSignals = await waitForStartableSession(
              accessToken,
              appId,
              nextEnqueuePayload,
              () => realtimeListener?.payloads() ?? [],
            );
            for (const nextToken of nextSignals.sessionTokens) {
              startPayload = await startStreamingSessionV2Upstream(accessToken, appId, nextToken);
              break;
            }
          }

          if (startPayload) break;
          if (errorCode === 340006) break;
          if (errorCode === 340007 || normalizeError(error).status === 400) {
            continue;
          }
          throw error;
        }
      }

      if (!startPayload) {
        const directSessionId = signals.sessionQueries.map(getSessionIdFromQuery).find(Boolean);
        if (directSessionId) {
          startPayload = { sessionId: directSessionId };
        }
      }
    } catch (error) {
      if (!hasFallbackStartCode(error)) {
        throw error;
      }
      useV1Fallback = true;
    } finally {
      realtimeListener?.close();
    }

    if (!startPayload && useV1Fallback) {
      startPayload = await startStreamingSessionV1Upstream(accessToken, appId);
    }

    if (!startPayload) {
      const error = new Error('Timed out waiting for Boosteroid to provide a startable virtual machine.');
      (error as Error & { status?: number; details?: unknown }).status = 504;
      (error as Error & { details?: unknown }).details = launchDiagnostics;
      throw error;
    }

    startUrl = findNestedString(startPayload, ['url', 'redirectUrl', 'streamingUrl']);
    const sessionId =
      findNestedString(startPayload, ['sessionId', 'sessionID', 'sid']) ??
      (startUrl ? extractSessionIdFromUrl(startUrl) : null);

    if (!sessionId) {
      const error = new Error('Boosteroid did not return a streaming session id.');
      (error as Error & { status?: number; details?: unknown }).status = 502;
      (error as Error & { details?: unknown }).details = startPayload;
      throw error;
    }

    gateways = findNestedGateways(startPayload, ['gateways', 'gateway', 'gw']);
    if (gateways.length === 0) {
      gateways = await getStreamingGatewaysUpstream(accessToken).catch(() => []);
    }

    const sessionDetails = await waitForStreamingSessionDetails(accessToken, sessionId);
    const detailsQuery = findNestedString(sessionDetails, ['queryString', 'query', 'sessionQuery']);
    const startQuery = findNestedString(startPayload, ['queryString', 'query', 'sessionQuery']);
    const detailsGateways = findNestedGateways(sessionDetails, ['gateways', 'gateway', 'gw']);
    const sessionQueries = uniq([
      ...(detailsQuery ? [detailsQuery] : []),
      ...(startQuery ? [startQuery] : []),
      ...extractSessionQueries(startPayload),
      ...[startUrl, streamingUrlToQuery(createStreamingUrl(sessionId, startUrl))].filter((value): value is string => Boolean(value)),
      `?sessionId=${sessionId}`,
    ]);
    if (detailsGateways.length > 0) {
      gateways = detailsGateways;
    }

    const streamAuth = getStreamClientAuth(accessToken);

    if (!sessionQueries.some((query) => query !== `?sessionId=${sessionId}`)) {
      const error = new Error('Boosteroid did not return a gateway stream query for the launched machine.');
      (error as Error & { status?: number; details?: unknown }).status = 502;
      (error as Error & { details?: unknown }).details = {
        sessionId,
        sessionDetails,
        startPayload,
      };
      throw error;
    }

    return {
      appId,
      app: appDetails,
      sessionId,
      streamingUrl: createStreamingUrl(sessionId, startUrl),
      gateways,
      streamClientConfig: {
        homeUrl: serverConfig.upstreamBaseUrl,
        sessionId,
        sessionQueries,
        gateways,
        accessToken: streamAuth.accessToken,
        authDataToken: streamAuth.authDataToken,
        preferredCodec: 'auto',
      },
      localStorage: {
        appId: String(appId),
        gateway_pings: gateways,
        homeLink: serverConfig.upstreamBaseUrl,
      },
      cookies: getCookieAuthCookies(accessToken),
      startPayload,
      sessionDetails,
      launchDiagnostics,
    };
  }

  function redactDebugValue(key: string, value: unknown): unknown {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes('token') ||
      normalizedKey.includes('cookie') ||
      normalizedKey.includes('authorization') ||
      normalizedKey.includes('session') ||
      normalizedKey.includes('auth') ||
      normalizedKey === 'value'
    ) {
      return typeof value === 'string' ? `[redacted:${value.length}]` : '[redacted]';
    }

    if (
      normalizedKey.includes('email') ||
      normalizedKey.includes('phone') ||
      normalizedKey === 'ip' ||
      normalizedKey.includes('address')
    ) {
      return typeof value === 'string' ? '[redacted]' : value;
    }

    return value;
  }

  function redactDebugPayload(value: unknown, key = ''): unknown {
    const redacted = redactDebugValue(key, value);
    if (redacted !== value) {
      return redacted;
    }

    if (Array.isArray(value)) {
      return value.map((item) => redactDebugPayload(item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
          entryKey,
          redactDebugPayload(entryValue, entryKey),
        ]),
      );
    }

    return value;
  }

  function sendCaptureStatus(req: Request, res: Response, captureId?: string) {
    const capture = authCaptureManager.getStatus(captureId);
    if (!capture) {
      res.status(404).json({ message: 'No login capture session found.' });
      return;
    }

    let sessionEstablished = false;
    if (capture.status === 'succeeded' && capture.bridgeSession) {
      const existingSession = readSession(req);
      const nextSession = createSession({
        accessToken: capture.bridgeSession.accessToken,
        refreshToken: capture.bridgeSession.refreshToken,
        userData: capture.bridgeSession.userData,
        user: capture.bridgeSession.user,
        existing: existingSession ?? capture.bridgeSession,
      });
      writeSession(res, nextSession);
      sessionEstablished = true;
    }

    res.json({
      id: capture.id,
      status: capture.status,
      startedAt: capture.startedAt,
      updatedAt: capture.updatedAt,
      completedAt: capture.completedAt,
      timeoutAt: capture.timeoutAt,
      loginUrl: capture.loginUrl,
      finalUrl: capture.finalUrl,
      errors: capture.errors,
      eventCount: capture.eventCount,
      user: capture.userPayload,
      captureMethod: capture.captureMethod,
      diagnostics: capture.diagnostics,
      sessionEstablished,
    });
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true, desktopBridge: true });
  });

  app.post('/auth/login/start', async (req, res, next) => {
    try {
      const requestedMethod = req.body?.method;
      const method: CaptureMethod = requestedMethod === 'browser' ? 'browser' : 'extension';
      const capture = await authCaptureManager.start(method);
      clearSession(res);
      res.status(202).json(capture);
    } catch (error) {
      next(error);
    }
  });

  app.get('/auth/login/status', (req, res) => {
    sendCaptureStatus(req, res);
  });

  app.get('/auth/login/status/:id', (req, res) => {
    sendCaptureStatus(req, res, req.params.id);
  });

  app.post('/auth/login/cancel', async (req, res, next) => {
    try {
      const captureId = typeof req.body?.id === 'string' ? req.body.id : undefined;
      const capture = await authCaptureManager.cancel(captureId);
      if (!capture) {
        res.status(404).json({ message: 'No active login capture session found.' });
        return;
      }

      clearSession(res);
      res.json({
        id: capture.id,
        status: capture.status,
        startedAt: capture.startedAt,
        updatedAt: capture.updatedAt,
        completedAt: capture.completedAt,
        timeoutAt: capture.timeoutAt,
        loginUrl: capture.loginUrl,
        finalUrl: capture.finalUrl,
        errors: capture.errors,
        eventCount: capture.eventCount,
        user: capture.userPayload,
        captureMethod: capture.captureMethod,
        sessionEstablished: false,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/auth/extension/active', (req, res) => {
    const body = req.body as ExtensionPairingRequest | undefined;
    const pairingCode = typeof body?.pairingCode === 'string' ? body.pairingCode : '';
    if (!pairingCode) {
      res.status(400).json({ message: 'Extension pairing code is required.' });
      return;
    }

    const active = authCaptureManager.getActiveExtensionSession(pairingCode);
    if (!active) {
      res.status(404).json({ message: 'No active extension capture session for that pairing code.' });
      return;
    }

    res.json(active);
  });

  app.post('/auth/extension/capture', async (req, res, next) => {
    try {
      const artifact = await authCaptureManager.ingestExtensionCapture(req.body);
      res.status(202).json({
        id: artifact.id,
        status: artifact.status,
        captureMethod: artifact.captureMethod,
        completedAt: artifact.completedAt,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/auth/logout', async (req, res) => {
    const session = readSession(req);
    clearSession(res);

    if (session) {
      try {
        await logoutUpstream(session.accessToken);
      } catch {
        res.status(204).end();
        return;
      }
    }

    res.status(204).end();
  });

  app.get('/auth/session', async (req, res, next) => {
    const session = readSession(req);
    if (!session) {
      clearSession(res);
      sendSession(res, null);
      return;
    }

    try {
      const refreshed = await withRefresh(session, getUpstreamUser);
      const nextSession = createSession({
        accessToken: refreshed.session.accessToken,
        refreshToken: refreshed.session.refreshToken,
        userData: refreshed.session.userData,
        user: refreshed.result,
        existing: refreshed.session,
      });

      writeSession(res, nextSession);
      sendSession(res, refreshed.result);
    } catch (error) {
      if (isCookieAuthToken(session.accessToken) && session.user) {
        sendSession(res, session.user);
        return;
      }

      clearSession(res);
      next(error);
    }
  });

  app.get('/auth/debug/capture', (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;

    const { artifact, path: artifactPath } = authCaptureManager.getLatestArtifact();
    if (!artifact) {
      res.status(404).json({ message: 'No auth capture artifact available yet.' });
      return;
    }

    res.json({
      artifact: redactDebugPayload(artifact),
      artifactPath,
      requestedBy: {
        email: session.user?.email ? '[redacted]' : null,
        updatedAt: session.updatedAt,
      },
    });
  });

  app.get('/me', async (req, res, next) => {
    const session = requireSession(req, res);
    if (!session) return;

    try {
      const refreshed = await withRefresh(session, getUpstreamUser);
      const nextSession = createSession({
        accessToken: refreshed.session.accessToken,
        refreshToken: refreshed.session.refreshToken,
        userData: refreshed.session.userData,
        user: refreshed.result,
        existing: refreshed.session,
      });

      writeSession(res, nextSession);
      res.json({ user: refreshed.result });
    } catch (error) {
      if (isCookieAuthToken(session.accessToken) && session.user) {
        res.json({ user: session.user });
        return;
      }

      clearSession(res);
      next(error);
    }
  });

  app.get('/library/installed', async (req, res, next) => {
    const session = requireSession(req, res);
    if (!session) return;

    try {
      const refreshed = await withRefresh(session, getInstalledGamesUpstream);
      writeSession(res, refreshed.session);
      res.json({ games: refreshed.result });
    } catch (error) {
      if (isCookieAuthToken(session.accessToken)) {
        next(error);
        return;
      }

      clearSession(res);
      next(error);
    }
  });

  app.post('/stream/launch', async (req, res, next) => {
    const session = requireSession(req, res);
    if (!session) return;

    const appId = Number(req.body?.appId);
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ message: 'A valid appId is required.' });
      return;
    }

    try {
      const launch = await launchStreamingSession(session, appId);
      res.json(launch);
    } catch (error) {
      if (!isCookieAuthToken(session.accessToken)) {
        clearSession(res);
      }
      next(error);
    }
  });

  const indexFile = path.join(serverConfig.distDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use(express.static(serverConfig.distDir));
    app.get(/.*/, (_req, res) => {
      res.sendFile(indexFile);
    });
  }

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    void next;
    const normalized = normalizeError(error);
    res.status(normalized.status).json({
      message: normalized.message,
      error: normalized.details,
    });
  });

  return app;
}

export function startBridgeServer(port = serverConfig.port) {
  const app = createBridgeApp();
  return app.listen(port, '127.0.0.1', () => {
    console.log(`OpenStroid desktop bridge listening on http://127.0.0.1:${port}`);
  });
}
