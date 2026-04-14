import fs from 'node:fs';
import path from 'node:path';

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function resolvePreferredBrowserExecutable(explicitPath: string | undefined): string | undefined {
  const candidatePaths = [
    explicitPath,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter((value): value is string => Boolean(value && value.trim()));

  return candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const configDir = import.meta.dirname;
const buildServerSuffix = `${path.sep}build${path.sep}server${path.sep}server`;
const projectRoot = configDir.endsWith(buildServerSuffix)
  ? path.resolve(configDir, '..', '..', '..')
  : path.resolve(configDir, '..');
const browserExecutablePath = resolvePreferredBrowserExecutable(process.env.BROWSER_EXECUTABLE_PATH);

export const serverConfig = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: parseNumber(process.env.PORT ?? process.env.SERVER_PORT, 3001),
  upstreamBaseUrl: process.env.UPSTREAM_BASE_URL ?? 'https://cloud.boosteroid.com',
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'openstroid_session',
  sessionSecret: process.env.SESSION_SECRET ?? 'openstroid-development-session-secret',
  sessionTtlSeconds: parseNumber(process.env.SESSION_TTL_SECONDS, 60 * 60 * 24 * 30),
  cookieSecure: parseBoolean(process.env.COOKIE_SECURE, nodeEnv === 'production'),
  appOrigin: process.env.APP_ORIGIN,
  authCaptureArtifactDir:
    process.env.AUTH_CAPTURE_ARTIFACT_DIR ??
    path.resolve(projectRoot, '.runtime', 'auth-captures'),
  browserUserDataDir:
    process.env.BROWSER_USER_DATA_DIR ??
    path.resolve(projectRoot, '.runtime', 'browser-profile'),
  browserLoginTimeoutMs: parseNumber(process.env.BROWSER_LOGIN_TIMEOUT_MS, 5 * 60 * 1000),
  browserLoginPollIntervalMs: parseNumber(process.env.BROWSER_LOGIN_POLL_INTERVAL_MS, 1500),
  browserLaunchNavigateTimeoutMs: parseNumber(
    process.env.BROWSER_LAUNCH_NAVIGATE_TIMEOUT_MS,
    30 * 1000,
  ),
  browserHeadless: parseBoolean(process.env.BROWSER_HEADLESS, false),
  browserExecutablePath,
  browserChannel: process.env.BROWSER_CHANNEL ?? (browserExecutablePath ? undefined : 'chrome'),
  browserLocale: process.env.BROWSER_LOCALE ?? 'en-US',
  browserLaunchArgs: (process.env.BROWSER_LAUNCH_ARGS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  distDir: path.resolve(projectRoot, 'dist'),
} as const;
