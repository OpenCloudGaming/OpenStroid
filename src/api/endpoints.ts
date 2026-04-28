import { apiClient } from './client';
import { API_CONFIG } from './config';
import type {
  AuthCaptureDebugResponse,
  AuthSession,
  InstalledGame,
  LoginCaptureMethod,
  LoginCaptureSessionStatus,
  LoginCaptureStartResponse,
  StreamLaunchResponse,
  User,
} from '../types';

function extractSession(data: Record<string, unknown>): AuthSession {
  return {
    authenticated: Boolean(data.authenticated),
    user: (data.user as User | null | undefined) ?? null,
  };
}

export async function startLoginCapture(method: LoginCaptureMethod = 'extension'): Promise<LoginCaptureStartResponse> {
  const { data } = await apiClient.post(API_CONFIG.endpoints.loginStart, { method });
  return data as LoginCaptureStartResponse;
}

export async function getLoginCaptureStatus(id?: string): Promise<LoginCaptureSessionStatus> {
  const url = id ? `${API_CONFIG.endpoints.loginStatus}/${id}` : API_CONFIG.endpoints.loginStatus;
  const { data } = await apiClient.get(url);
  return data as LoginCaptureSessionStatus;
}

export async function cancelLoginCapture(id?: string): Promise<LoginCaptureSessionStatus> {
  const { data } = await apiClient.post(API_CONFIG.endpoints.loginCancel, id ? { id } : {});
  return data as LoginCaptureSessionStatus;
}

export async function getAuthCaptureDebug(): Promise<AuthCaptureDebugResponse> {
  const { data } = await apiClient.get(API_CONFIG.endpoints.loginDebugCapture);
  return data as AuthCaptureDebugResponse;
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

export async function launchStream(appId: number): Promise<StreamLaunchResponse> {
  const { data } = await apiClient.post(API_CONFIG.endpoints.streamLaunch, { appId }, { timeout: 190000 });
  return data as StreamLaunchResponse;
}
