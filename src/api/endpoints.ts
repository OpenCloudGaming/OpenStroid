import { apiClient } from './client';
import { API_CONFIG } from './config';
import type {
  AuthCaptureDebugResponse,
  AuthSession,
  InstalledGame,
  LibraryFacet,
  LibraryDashboard,
  LoginCaptureMethod,
  LoginCaptureSessionStatus,
  LoginCaptureStartResponse,
  QRCodeLoginSessionStatus,
  StreamSessionResponse,
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

export async function startQRCodeLogin(): Promise<QRCodeLoginSessionStatus> {
  const { data } = await apiClient.post(API_CONFIG.endpoints.qrLoginStart);
  return data as QRCodeLoginSessionStatus;
}

export async function getQRCodeLoginStatus(id?: string): Promise<QRCodeLoginSessionStatus> {
  const url = id ? `${API_CONFIG.endpoints.qrLoginStatus}/${id}` : API_CONFIG.endpoints.qrLoginStatus;
  const { data } = await apiClient.get(url);
  return data as QRCodeLoginSessionStatus;
}

export async function cancelQRCodeLogin(id?: string): Promise<QRCodeLoginSessionStatus> {
  const { data } = await apiClient.post(API_CONFIG.endpoints.qrLoginCancel, id ? { id } : {});
  return data as QRCodeLoginSessionStatus;
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

export async function getLibraryDashboard(): Promise<LibraryDashboard> {
  const { data } = await apiClient.get(API_CONFIG.endpoints.libraryDashboard);
  return data as LibraryDashboard;
}

export async function getLibraryFacets(): Promise<LibraryDashboard['facets']> {
  const { data } = await apiClient.get(API_CONFIG.endpoints.libraryFacets);
  return {
    collections: Array.isArray(data?.collections) ? data.collections as LibraryFacet[] : [],
    genres: Array.isArray(data?.genres) ? data.genres as LibraryFacet[] : [],
    platforms: Array.isArray(data?.platforms) ? data.platforms as LibraryFacet[] : [],
    orderBy: Array.isArray(data?.orderBy) ? data.orderBy as LibraryFacet[] : [],
    languages: Array.isArray(data?.languages) ? data.languages as LibraryFacet[] : [],
  };
}

export async function getCatalogGames(params: Record<string, unknown> = {}): Promise<InstalledGame[]> {
  const { data } = await apiClient.get(API_CONFIG.endpoints.libraryCatalog, { params });
  if (Array.isArray(data?.games)) return data.games as InstalledGame[];
  return [];
}

export async function searchCatalogGames(params: Record<string, unknown> = {}): Promise<InstalledGame[]> {
  const { data } = await apiClient.get(API_CONFIG.endpoints.librarySearch, { params });
  if (Array.isArray(data?.games)) return data.games as InstalledGame[];
  return [];
}

export async function getNewGames(params: Record<string, unknown> = {}): Promise<InstalledGame[]> {
  const { data } = await apiClient.get(API_CONFIG.endpoints.libraryNew, { params });
  if (Array.isArray(data?.games)) return data.games as InstalledGame[];
  return [];
}

export async function getGameDetails(appId: number): Promise<InstalledGame | null> {
  const { data } = await apiClient.get(`${API_CONFIG.endpoints.libraryApps}/${appId}`);
  return (data?.game as InstalledGame | null | undefined) ?? null;
}

export async function installGame(appId: number): Promise<Record<string, unknown>> {
  const { data } = await apiClient.post(`${API_CONFIG.endpoints.libraryApps}/${appId}/install`);
  return (data?.result ?? {}) as Record<string, unknown>;
}

export async function uninstallGame(appId: number): Promise<Record<string, unknown>> {
  const { data } = await apiClient.post(`${API_CONFIG.endpoints.libraryApps}/${appId}/uninstall`);
  return (data?.result ?? {}) as Record<string, unknown>;
}

export async function synchronizePlatform(platform: string): Promise<Record<string, unknown>> {
  const { data } = await apiClient.post(`${API_CONFIG.endpoints.librarySync}/${platform}`);
  return (data?.result ?? {}) as Record<string, unknown>;
}

export async function launchStream(appId: number): Promise<StreamLaunchResponse> {
  const { data } = await apiClient.post(API_CONFIG.endpoints.streamLaunch, { appId }, { timeout: 190000 });
  return data as StreamLaunchResponse;
}

export async function dequeueStreamSession(): Promise<Record<string, unknown>> {
  const { data } = await apiClient.post(API_CONFIG.endpoints.streamDequeue);
  return (data?.result ?? {}) as Record<string, unknown>;
}

export async function getActiveStreamSessions(): Promise<StreamSessionResponse> {
  const { data } = await apiClient.get(API_CONFIG.endpoints.streamActiveSessions);
  return data as StreamSessionResponse;
}

export async function getLastStreamSession(): Promise<StreamSessionResponse> {
  const { data } = await apiClient.get(API_CONFIG.endpoints.streamLastSession);
  return data as StreamSessionResponse;
}

export async function logStreamSession(payload: Record<string, unknown>): Promise<void> {
  await apiClient.post(API_CONFIG.endpoints.streamSessionLog, payload);
}

export async function submitStreamSessionEvaluation(payload: Record<string, unknown>): Promise<void> {
  await apiClient.post(API_CONFIG.endpoints.streamSessionEvaluation, payload);
}
