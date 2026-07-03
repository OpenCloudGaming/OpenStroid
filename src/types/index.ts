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
