const LEGACY_STORAGE_KEYS = ['access_token', 'refresh_token', 'boosteroid_auth'] as const;

export function clearLegacyAuthStorage(): void {
  for (const key of LEGACY_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}
