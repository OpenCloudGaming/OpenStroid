import os from 'node:os';

export const ANDROID_TV_CLIENT_ID = 6;
export const ANDROID_TV_ENTRYPOINT_COOKIE = 'boosteroid_entrypoint_source=1;boosteroid_entrypoint_page=1';

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function deviceModel(): string {
  return 'OpenStroid Desktop';
}

function deviceIdentifier(): string {
  return compact(os.hostname()) || 'OpenStroid';
}

function systemVersion(): string {
  return compact(os.release()) || '0';
}

function sdkInt(): string {
  return systemVersion().split('.')[0] || '0';
}

export function androidTvRequestHeaders(): Record<string, string> {
  const model = deviceModel();
  return {
    'User-Agent': `BoosteroidAndroidTVClient tv.1.2.9; Android ${systemVersion()}; ${model}`,
    'Device-Name': `${deviceIdentifier()} ${model} ${sdkInt()}`,
    'Device-Uniq-Id': '',
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Nonce: '0',
  };
}

export function androidTvQrSyncHeaders(): Record<string, string> {
  return {
    ...androidTvRequestHeaders(),
    Cookie: ANDROID_TV_ENTRYPOINT_COOKIE,
  };
}

export function appendAndroidTvEntrypointCookie(cookieHeader: string | undefined): string {
  if (!cookieHeader) return ANDROID_TV_ENTRYPOINT_COOKIE;
  if (cookieHeader.includes('boosteroid_entrypoint_source=')) return cookieHeader;
  return `${cookieHeader}; ${ANDROID_TV_ENTRYPOINT_COOKIE}`;
}
