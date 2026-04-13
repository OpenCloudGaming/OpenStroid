const STORAGE_KEYS = {
  accessToken: 'access_token',
  refreshToken: 'refresh_token',
  boosteroidAuth: 'boosteroid_auth',
} as const;

export function getAccessToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.accessToken);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.refreshToken);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(STORAGE_KEYS.accessToken, accessToken);
  localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken);
  localStorage.setItem(STORAGE_KEYS.boosteroidAuth, 'true');
}

export function clearTokens(): void {
  localStorage.removeItem(STORAGE_KEYS.accessToken);
  localStorage.removeItem(STORAGE_KEYS.refreshToken);
  localStorage.removeItem(STORAGE_KEYS.boosteroidAuth);
}

export function hasStoredSession(): boolean {
  return !!getAccessToken() && !!getRefreshToken();
}
