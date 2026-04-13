import { apiClient } from './client';
import { API_CONFIG } from './config';
import { buildLoginPayload } from '../auth/login-adapter';
import type { AuthTokens, LoginCredentials, User, InstalledGame } from '../types';

export async function login(credentials: LoginCredentials): Promise<AuthTokens> {
  const payload = buildLoginPayload(credentials);
  const { data } = await apiClient.post(API_CONFIG.endpoints.login, payload);
  return data as AuthTokens;
}

export async function refreshToken(token: string): Promise<AuthTokens> {
  const { data } = await apiClient.post(API_CONFIG.endpoints.refreshToken, {
    refresh_token: token,
  });
  return data as AuthTokens;
}

export async function logout(): Promise<void> {
  await apiClient.post(API_CONFIG.endpoints.logout);
}

export async function getCurrentUser(): Promise<User> {
  const { data } = await apiClient.get(API_CONFIG.endpoints.user);
  return data as User;
}

export async function getInstalledGames(): Promise<InstalledGame[]> {
  const { data } = await apiClient.get(API_CONFIG.endpoints.installedGames);
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.applications && Array.isArray(data.applications)) return data.applications;
  return [];
}
