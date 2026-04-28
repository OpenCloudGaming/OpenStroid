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
  getInstalledGamesUpstream,
  getUpstreamUser,
  isCookieAuthToken,
  logoutUpstream,
  normalizeError,
  withRefresh,
} from './lib/upstream.js';

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
      artifact,
      artifactPath,
      requestedBy: {
        email: session.user?.email ?? null,
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
