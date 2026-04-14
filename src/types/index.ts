export interface User {
  id: number;
  email: string;
  name?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface AuthSession {
  authenticated: boolean;
  user: User | null;
}

export type LoginCaptureStatus =
  | 'starting'
  | 'awaiting_user'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type LoginCaptureMethod = 'extension' | 'browser';

export interface LoginCaptureStartResponse {
  id: string;
  status: LoginCaptureStatus;
  timeoutAt: string;
  captureMethod: LoginCaptureMethod;
  loginUrl: string;
}

export interface LoginCaptureSessionStatus {
  id: string;
  status: LoginCaptureStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  timeoutAt: string;
  loginUrl: string;
  finalUrl: string | null;
  errors: string[];
  eventCount: number;
  user: User | null;
  captureMethod: LoginCaptureMethod;
  sessionEstablished: boolean;
}

export interface CaptureEvent {
  timestamp: string;
  type: 'page' | 'request' | 'response' | 'note' | 'error';
  method?: string;
  url?: string;
  status?: number;
  payload?: unknown;
  headers?: Record<string, string>;
  cookieNames?: string[];
  message?: string;
  source?: 'browser' | 'extension';
}

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

export interface CaptureArtifact {
  id: string;
  captureMethod: LoginCaptureMethod;
  status: LoginCaptureStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  timeoutAt: string;
  loginUrl: string;
  finalUrl: string | null;
  upstreamBaseUrl: string;
  errors: string[];
  eventCount: number;
  authCookies: Partial<Record<'access_token' | 'refresh_token' | 'boosteroid_auth' | 'qr_auth_code', StoredCookie>>;
  allCookies: StoredCookie[];
  observedResponses: CaptureEvent[];
  userPayload: User | null;
  bridgeSession: {
    accessToken: string;
    refreshToken: string;
    userData?: unknown;
    user?: User;
    createdAt: number;
    updatedAt: number;
  } | null;
  ingestSource?: 'browser' | 'extension';
  extensionMetadata?: Record<string, unknown>;
}

export interface AuthCaptureDebugResponse {
  artifact: CaptureArtifact;
  artifactPath: string | null;
  requestedBy: {
    email: string | null;
    updatedAt: number;
  };
}

export interface InstalledGame {
  id: number;
  name: string;
  slug?: string;
  icon?: string;
  cover?: string;
  description?: string;
  [key: string]: unknown;
}

export interface ApiError {
  message?: string;
  error_code?: number;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
}
