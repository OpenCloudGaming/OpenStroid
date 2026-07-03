import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { startBridgeServer } from '../server/app.js';
import { serverConfig } from '../server/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const preloadPath = path.join(__dirname, 'preload.cjs');

let bridgePort = serverConfig.port;
const pendingStreamLaunches = new Map<string, StreamLaunchPayload>();
const streamLaunchIdsByWebContents = new Map<number, string>();

interface StreamLaunchCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

interface StreamLaunchPayload {
  streamingUrl: string;
  streamClientConfig?: unknown;
  localStorage?: Record<string, unknown>;
  cookies?: StreamLaunchCookie[];
}

function mapSameSite(value: string | undefined): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  const normalized = value?.toLowerCase();
  if (normalized === 'none' || normalized === 'no_restriction') return 'no_restriction';
  if (normalized === 'strict') return 'strict';
  if (normalized === 'lax') return 'lax';
  return 'unspecified';
}

function cookieUrl(cookie: StreamLaunchCookie): string {
  const domain = cookie.domain.replace(/^\./, '');
  return `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`;
}

async function installStreamCookies(cookies: StreamLaunchCookie[] = []) {
  await Promise.all(cookies.map((cookie) => session.defaultSession.cookies.set({
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain || undefined,
    path: cookie.path || '/',
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: mapSameSite(cookie.sameSite),
    expirationDate: cookie.expires > 0 ? cookie.expires : undefined,
  })));
}

function attachWindowLogging(window: BrowserWindow, label: string) {
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const source = sourceId ? ` ${sourceId}:${line}` : '';
    console.log(`[${label}:console:${level}]${source} ${message}`);
  });

  window.webContents.on('did-finish-load', () => {
    console.log(`[${label}] loaded ${window.webContents.getURL()}`);
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[${label}] load failed ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[${label}] render process gone`, details);
  });

  window.webContents.on('preload-error', (_event, preloadPathValue, error) => {
    console.error(`[${label}] preload failed ${preloadPathValue}`, error);
  });
}

function rendererUrlForPath(routePath: string): string {
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `http://127.0.0.1:${bridgePort}${normalizedPath}`;
}

function registerIpcHandlers() {
  ipcMain.handle('openstroid:open-stream', async (event, launch: StreamLaunchPayload) => {
    if (!launch?.streamingUrl) {
      throw new Error('Missing stream launch URL.');
    }

    await installStreamCookies(launch.cookies);
    console.log(`[main] open stream requested session=${launch.streamClientConfig && typeof launch.streamClientConfig === 'object' && 'sessionId' in launch.streamClientConfig ? String(launch.streamClientConfig.sessionId) : 'unknown'}`);
    const streamLaunchId = randomUUID();
    pendingStreamLaunches.set(streamLaunchId, launch);
    streamLaunchIdsByWebContents.set(event.sender.id, streamLaunchId);
    console.log(`[main] navigating current window to stream launchId=${streamLaunchId} webContents=${event.sender.id}`);
    await event.sender.loadURL(rendererUrlForPath('/stream'));
    return { ok: true };
  });

  ipcMain.handle('openstroid:get-stream-launch', (event) => {
    const streamLaunchId = streamLaunchIdsByWebContents.get(event.sender.id);
    const launch = streamLaunchId ? (pendingStreamLaunches.get(streamLaunchId) ?? null) : null;
    console.log(`[main] stream launch lookup webContents=${event.sender.id} launchId=${streamLaunchId ?? 'none'} found=${Boolean(launch)}`);
    return launch;
  });
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    title: 'OpenStroid',
    autoHideMenuBar: true,
    backgroundColor: '#11131a',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false,
    },
  });
  attachWindowLogging(window, 'main');

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void window.loadURL(`http://127.0.0.1:${bridgePort}`);
}

async function bootstrapDesktopApp() {
  const server = await startBridgeServer(serverConfig.port);
  const address = server.address();
  if (address && typeof address !== 'string') {
    bridgePort = (address as AddressInfo).port;
  }

  createMainWindow();
  registerIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    server.close();
  });
}

app.whenReady().then(() => {
  app.setName('OpenStroid');
  if (process.platform === 'win32') {
    app.setAppUserModelId('ai.capy.openstroid');
  }
  void bootstrapDesktopApp();
});
