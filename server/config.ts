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

const nodeEnv = process.env.NODE_ENV ?? 'development';
const configDir = import.meta.dirname;
const buildServerSuffix = `${path.sep}build${path.sep}server${path.sep}server`;
const electronBuildServerSuffix = `${path.sep}build${path.sep}electron${path.sep}server`;
const projectRoot = configDir.endsWith(buildServerSuffix)
  || configDir.endsWith(electronBuildServerSuffix)
  ? path.resolve(configDir, '..', '..', '..')
  : path.resolve(configDir, '..');
const runtimeDir = process.env.OPENSTROID_RUNTIME_DIR ?? path.resolve(projectRoot, '.runtime');

export const serverConfig = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  projectRoot,
  port: parseNumber(process.env.PORT ?? process.env.SERVER_PORT, 3001),
  upstreamBaseUrl: process.env.UPSTREAM_BASE_URL ?? 'https://cloud.boosteroid.com',
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'openstroid_session',
  sessionSecret: process.env.SESSION_SECRET ?? 'openstroid-development-session-secret',
  sessionTtlSeconds: parseNumber(process.env.SESSION_TTL_SECONDS, 60 * 60 * 24 * 30),
  cookieSecure: parseBoolean(process.env.COOKIE_SECURE, nodeEnv === 'production'),
  appOrigin: process.env.APP_ORIGIN,
  cookieAuthStorePath:
    process.env.COOKIE_AUTH_STORE_PATH ??
    path.resolve(runtimeDir, 'cookie-auth-sessions.json'),
  distDir: path.resolve(projectRoot, 'dist'),
} as const;
