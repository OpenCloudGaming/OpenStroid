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

interface StreamLaunchCookie {
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
  colorMode: 'SDR';
  colorSpace?: {
    primaries: string | null;
    transfer: string | null;
    matrix: string | null;
    fullRange: boolean | null;
  };
  at: number;
}

export interface ApiError {
  message?: string;
  error_code?: number;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
}
