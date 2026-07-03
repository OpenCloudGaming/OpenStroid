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
  sessionHandoff?: string | null;
}

export type LoginCaptureStatus =
  | 'starting'
  | 'awaiting_user'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type LoginCaptureMethod = 'extension';

export type QRCodeLoginStatus =
  | 'polling'
  | 'succeeded'
  | 'cancelled'
  | 'timed_out';

export interface QRCodeLoginSessionStatus {
  id: string;
  status: QRCodeLoginStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  timeoutAt: string;
  validationUrl: string;
  qrCodeDataUrl: string;
  errors: string[];
  user: User | null;
  sessionEstablished: boolean;
  sessionHandoff?: string | null;
  pollIntervalMs: number;
}

export interface LoginCaptureStartResponse {
  id: string;
  status: LoginCaptureStatus;
  timeoutAt: string;
  captureMethod: LoginCaptureMethod;
  loginUrl: string;
  extensionPairingCode?: string;
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
  diagnostics?: CaptureDiagnostics;
  sessionEstablished: boolean;
}

export interface CaptureDiagnostics {
  tokenSource?: 'payload' | 'storage' | 'cookie' | 'none';
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  authCookieNames?: string[];
  storageKeys?: string[];
  relevantResponseSummary?: Array<{
    type: CaptureEvent['type'];
    method?: string;
    url?: string;
    status?: number;
    payloadKeys?: string[];
  }>;
  upstreamValidation?: {
    status?: number;
    message: string;
  };
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
  source?: 'extension';
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
  ingestSource?: 'extension';
  extensionMetadata?: Record<string, unknown>;
  diagnostics?: CaptureDiagnostics;
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

export interface LibraryFacet {
  id?: number | string;
  key?: string;
  slug?: string;
  name?: string;
  title?: string;
  value?: string;
  [key: string]: unknown;
}

export interface LibraryDashboard {
  user: User | null;
  installedGames: InstalledGame[];
  catalogGames: InstalledGame[];
  newGames: InstalledGame[];
  carousel: Array<Record<string, unknown>>;
  facets: {
    collections: LibraryFacet[];
    genres: LibraryFacet[];
    platforms: LibraryFacet[];
    orderBy: LibraryFacet[];
    languages: LibraryFacet[];
  };
  account: {
    subscriptions: Array<Record<string, unknown>>;
  };
  sessions: {
    active: Record<string, unknown> | null;
    last: Record<string, unknown> | null;
  };
  generatedAt: string;
}

export interface StreamSessionResponse {
  session?: Record<string, unknown> | null;
  sessions?: Record<string, unknown> | null;
  gateways?: unknown[];
  result?: Record<string, unknown>;
}

export interface StreamLaunchCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

export interface StreamLaunchResponse {
  appId: number;
  app: Record<string, unknown> | null;
  sessionId: string;
  streamingUrl: string;
  gateways: unknown[];
  streamClientConfig: StreamClientConfig;
  localStorage: Record<string, unknown>;
  cookies: StreamLaunchCookie[];
  startPayload: Record<string, unknown>;
  sessionDetails?: Record<string, unknown> | null;
}

export interface StreamClientConfig {
  homeUrl: string;
  sessionId: string;
  sessionQuery?: string;
  sessionQueries: string[];
  gateways: unknown[];
  accessToken: string;
  authDataToken: string;
  preferredCodec?: 'auto' | 'av1' | 'h264';
}

export interface StreamRealtimeStats {
  bitrate: number;
  decodedFps: number;
  receivedFps: number;
  packetLoss: number;
  connectionState: RTCPeerConnectionState | 'unknown';
  gatewayHost: string;
  codec?: string;
  at: number;
}

export interface ControllerConnectedEvent {
  type: 'controller';
  action: 'connected';
  name: string;
}

export interface ControllerDisconnectedEvent {
  type: 'controller';
  action: 'disconnected';
  id: number;
}

export interface ControllerButtonEvent {
  type: 'controller';
  action: 'button';
  id: number;
  button: number;
  value: number;
}

export interface ControllerAxesEvent {
  type: 'controller';
  action: 'axes';
  id: number;
  axes: number;
  value: number;
}

export interface ControllerPadEvent {
  type: 'controller';
  action: 'pad';
  id: number;
  hat: number;
}

export interface ControllerRumbleMessage {
  type: 'controller';
  action: 'rumble';
  id: number;
  left: number;
  right: number;
}

export type ControllerOutboundEvent =
  | ControllerConnectedEvent
  | ControllerDisconnectedEvent
  | ControllerButtonEvent
  | ControllerAxesEvent
  | ControllerPadEvent;

export interface ApiError {
  message?: string;
  error_code?: number;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
}
