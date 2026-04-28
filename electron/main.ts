import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { startBridgeServer } from '../server/app.js';
import { serverConfig } from '../server/config.js';

const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:3000';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const preloadPath = path.join(__dirname, 'preload.cjs');

let bridgePort = serverConfig.port;

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
  localStorage?: Record<string, unknown>;
  cookies?: StreamLaunchCookie[];
}

function encodeStreamState(localStorageState: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify({ localStorage: localStorageState }), 'utf8').toString('base64url');
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

function createStreamWindow(launch: StreamLaunchPayload) {
  const streamWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 540,
    title: 'OpenStroid Stream',
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [
        `--openstroid-stream-state=${encodeStreamState(launch.localStorage ?? {})}`,
      ],
    },
  });

  streamWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void streamWindow.loadURL(launch.streamingUrl);
}

function registerIpcHandlers() {
  ipcMain.handle('openstroid:open-stream', async (_event, launch: StreamLaunchPayload) => {
    if (!launch?.streamingUrl) {
      throw new Error('Missing stream launch URL.');
    }

    await installStreamCookies(launch.cookies);
    createStreamWindow(launch);
    return { ok: true };
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
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (serverConfig.isProduction) {
    void window.loadURL(`http://127.0.0.1:${bridgePort}`);
  } else {
    void window.loadURL(DEV_RENDERER_URL);
  }
}

async function bootstrapDesktopApp() {
  const server = startBridgeServer(serverConfig.port);
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
