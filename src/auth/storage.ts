const LEGACY_STORAGE_KEYS = ['access_token', 'refresh_token', 'boosteroid_auth'] as const;
const SESSION_HANDOFF_KEY = 'openstroid:session-handoff';

export function readSessionHandoff(): string | null {
  return sessionStorage.getItem(SESSION_HANDOFF_KEY);
}

export function writeSessionHandoff(value: string | null | undefined): void {
  if (value) {
    sessionStorage.setItem(SESSION_HANDOFF_KEY, value);
    return;
  }
  sessionStorage.removeItem(SESSION_HANDOFF_KEY);
}

export function clearLegacyAuthStorage(): void {
  for (const key of LEGACY_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}

function clearSessionHandoff(): void {
  writeSessionHandoff(null);
}

export function clearAuthStorage(): void {
  clearLegacyAuthStorage();
  clearSessionHandoff();
}
