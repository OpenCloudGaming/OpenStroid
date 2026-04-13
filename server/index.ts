import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { serverConfig } from './config.js';
import { clearSession, createSession, readSession, writeSession } from './lib/session.js';
import {
  getInstalledGamesUpstream,
  getUpstreamUser,
  loginUpstream,
  logoutUpstream,
  normalizeError,
  withRefresh,
} from './lib/upstream.js';

const app = express();

app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  if (serverConfig.appOrigin) {
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

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/auth/login', async (req, res, next) => {
  try {
    const body = req.body as Record<string, string | boolean | undefined>;
    const payload: Record<string, string | boolean> = {
      email: String(body.email ?? '').trim().toLowerCase(),
      password: String(body.password ?? ''),
      remember_me: Boolean(body.remember_me),
    };

    const turnstileToken = body['cf-turnstile-response'];
    if (typeof turnstileToken === 'string' && turnstileToken.length > 0) {
      payload['cf-turnstile-response'] = turnstileToken;
    }

    const tokens = await loginUpstream(payload);
    const user = await getUpstreamUser(tokens.access_token);
    const session = createSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      userData: tokens.user_data,
      user,
    });

    writeSession(res, session);
    sendSession(res, user);
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
    clearSession(res);
    next(error);
  }
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

app.listen(serverConfig.port, () => {
  console.log(`OpenStroid auth bridge listening on http://localhost:${serverConfig.port}`);
});
