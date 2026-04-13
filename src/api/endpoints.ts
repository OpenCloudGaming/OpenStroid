import { apiClient } from './client';
import { API_CONFIG } from './config';
import { buildLoginPayload } from '../auth/login-adapter';
import type { AuthSession, InstalledGame, LoginCredentials, User } from '../types';

function extractSession(data: Record<string, unknown>): AuthSession {
  return {
    authenticated: Boolean(data.authenticated),
    user: (data.user as User | null | undefined) ?? null,
  };
}

export async function login(credentials: LoginCredentials): Promise<AuthSession> {
  const payload = buildLoginPayload(credentials);
  const { data } = await apiClient.post(API_CONFIG.endpoints.login, payload);
  return extractSession(data);
}

export async function logout(): Promise<void> {
  await apiClient.post(API_CONFIG.endpoints.logout);
}

export async function getSession(): Promise<AuthSession> {
  const { data } = await apiClient.get(API_CONFIG.endpoints.session);
  return extractSession(data);
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  return session.user;
}

export async function getInstalledGames(): Promise<InstalledGame[]> {
  const { data } = await apiClient.get(API_CONFIG.endpoints.installedGames);
  if (Array.isArray(data?.games)) return data.games as InstalledGame[];
  return [];
}
