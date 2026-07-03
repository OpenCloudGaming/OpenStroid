import { randomUUID } from 'node:crypto';
import axios from 'axios';
import QRCode from 'qrcode';
import { serverConfig } from '../config.js';
import { androidTvQrSyncHeaders, ANDROID_TV_CLIENT_ID } from './androidTvIdentity.js';
import { createSession, type BridgeSession } from './session.js';
import { getUpstreamUser, unwrapRecord } from './upstream.js';

const POLL_INTERVAL_MS = 3000;
const QR_TIMEOUT_MS = 5 * 60 * 1000;
const QR_LIGHT_COLOR = '#eeeeeeff';
const QR_DARK_COLOR = '#000000ff';
const SYNC_ENDPOINT = '/api/v1/auth/login/qr-code/sync';
const VALIDATION_ENDPOINT = '/api/v1/auth/login/qr-code/validate';
const TERMINAL_STATUSES = new Set<QRCodeLoginStatus>(['succeeded', 'cancelled', 'timed_out']);

export type QRCodeLoginStatus = 'polling' | 'succeeded' | 'cancelled' | 'timed_out';

export interface QRCodeLoginArtifact {
  id: string;
  status: QRCodeLoginStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  timeoutAt: string;
  validationUrl: string;
  qrCodeDataUrl: string;
  errors: string[];
  userPayload: Record<string, unknown> | null;
  bridgeSession: BridgeSession | null;
  pollIntervalMs: number;
}

interface QRCodeLoginRuntime {
  id: string;
  authCode: string;
  validationUrl: string;
  qrCodeDataUrl: string;
  status: QRCodeLoginStatus;
  startedAtMs: number;
  updatedAtMs: number;
  completedAtMs: number | null;
  timeoutAtMs: number;
  errors: string[];
  bridgeSession: BridgeSession | null;
  timer: NodeJS.Timeout | null;
}

const qrSyncClient = axios.create({
  baseURL: serverConfig.upstreamBaseUrl,
  timeout: 30_000,
  validateStatus: () => true,
});

function isTerminalStatus(status: QRCodeLoginStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function toIso(ms: number | null): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function makeValidationUrl(authCode: string): string {
  const url = new URL(VALIDATION_ENDPOINT, serverConfig.upstreamBaseUrl);
  url.searchParams.set('auth-code', authCode);
  return url.toString();
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function parseExpiresAt(value: unknown): number | null {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : null;

  if (typeof numericValue === 'number' && Number.isFinite(numericValue)) {
    return numericValue > 1_000_000_000
      ? numericValue * 1000
      : Date.now() + numericValue * 1000;
  }

  if (typeof value !== 'string' || !value) return null;

  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function createUserFallback(userData: unknown): Record<string, unknown> | undefined {
  if (!userData || typeof userData !== 'object') return undefined;
  const candidate = unwrapRecord(userData);
  if (typeof candidate.id !== 'undefined' || typeof candidate.email === 'string') {
    return candidate;
  }
  return undefined;
}

function createQRCodeSessionFromPayload(payload: unknown): BridgeSession {
  const object = unwrapRecord(payload);
  const accessToken = stringOrNull(object.access_token);
  const refreshToken = stringOrNull(object.refresh_token);

  if (!accessToken || !refreshToken) {
    throw new Error('QR login completed without usable Boosteroid auth tokens.');
  }

  const userData = object.user_data;
  const user = object.user && typeof object.user === 'object'
    ? unwrapRecord(object.user)
    : createUserFallback(userData);

  return createSession({
    accessToken,
    refreshToken,
    userData,
    user,
    sessionId: stringOrNull(object.session_id),
    expiresAt: parseExpiresAt(object.expires_in),
    usesAndroidTVIdentity: true,
  });
}

export class QRCodeLoginManager {
  private active: QRCodeLoginRuntime | null = null;
  private latest: QRCodeLoginArtifact | null = null;

  async start(): Promise<QRCodeLoginArtifact> {
    await this.cancelActive('Replaced by a new QR code.');

    const now = Date.now();
    const authCode = randomUUID().toLowerCase();
    const validationUrl = makeValidationUrl(authCode);
    const qrCodeDataUrl = await QRCode.toDataURL(validationUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 500,
      color: {
        dark: QR_DARK_COLOR,
        light: QR_LIGHT_COLOR,
      },
    });

    const session: QRCodeLoginRuntime = {
      id: randomUUID(),
      authCode,
      validationUrl,
      qrCodeDataUrl,
      status: 'polling',
      startedAtMs: now,
      updatedAtMs: now,
      completedAtMs: null,
      timeoutAtMs: now + QR_TIMEOUT_MS,
      errors: [],
      bridgeSession: null,
      timer: null,
    };

    this.active = session;
    this.schedulePoll(session, 0);
    return this.toArtifact(session);
  }

  getStatus(id?: string): QRCodeLoginArtifact | null {
    this.expireIfTimedOut(this.active);
    if (this.active && (!id || this.active.id === id)) {
      return this.toArtifact(this.active);
    }
    if (this.latest && (!id || this.latest.id === id)) {
      return this.latest;
    }
    return null;
  }

  async cancel(id?: string): Promise<QRCodeLoginArtifact | null> {
    const session = this.active;
    if (!session || (id && session.id !== id)) return null;
    await this.finalize(session, 'cancelled', 'QR login cancelled.');
    return this.toArtifact(session);
  }

  private async cancelActive(message: string): Promise<void> {
    if (this.active && !isTerminalStatus(this.active.status)) {
      await this.finalize(this.active, 'cancelled', message);
    }
    this.active = null;
  }

  private schedulePoll(session: QRCodeLoginRuntime, delayMs: number): void {
    if (isTerminalStatus(session.status)) return;
    if (session.timer) {
      clearTimeout(session.timer);
    }
    session.timer = setTimeout(() => {
      void this.pollOnce(session);
    }, delayMs);
  }

  private async pollOnce(session: QRCodeLoginRuntime): Promise<void> {
    if (this.active?.id !== session.id || isTerminalStatus(session.status)) return;
    if (Date.now() >= session.timeoutAtMs) {
      await this.finalize(session, 'timed_out', 'QR login timed out before the code was verified.');
      return;
    }

    try {
      const response = await qrSyncClient.post(SYNC_ENDPOINT, {
        'auth-code': session.authCode,
        clientId: ANDROID_TV_CLIENT_ID,
      }, {
        headers: androidTvQrSyncHeaders(),
      });

      if (response.status === 200) {
        const bridgeSession = createQRCodeSessionFromPayload(response.data);
        if (!bridgeSession.user) {
          bridgeSession.user = await getUpstreamUser(bridgeSession).catch(() => bridgeSession.user);
        }
        session.bridgeSession = bridgeSession;
        await this.finalize(session, 'succeeded');
        return;
      }
    } catch {
      // Android TV keeps QR polling alive across transient decode/request failures.
    }

    session.updatedAtMs = Date.now();
    this.schedulePoll(session, POLL_INTERVAL_MS);
  }

  private expireIfTimedOut(session: QRCodeLoginRuntime | null): void {
    if (!session || isTerminalStatus(session.status) || Date.now() < session.timeoutAtMs) return;
    void this.finalize(session, 'timed_out', 'QR login timed out before the code was verified.');
  }

  private async finalize(
    session: QRCodeLoginRuntime,
    status: QRCodeLoginStatus,
    message?: string,
  ): Promise<void> {
    if (isTerminalStatus(session.status)) return;
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    session.status = status;
    session.updatedAtMs = Date.now();
    session.completedAtMs = Date.now();
    if (message && status !== 'succeeded') {
      session.errors.push(message);
    }
    const artifact = this.toArtifact(session);
    this.latest = artifact;
    if (this.active?.id === session.id && isTerminalStatus(status)) {
      this.active = session;
    }
  }

  private toArtifact(session: QRCodeLoginRuntime): QRCodeLoginArtifact {
    return {
      id: session.id,
      status: session.status,
      startedAt: new Date(session.startedAtMs).toISOString(),
      updatedAt: new Date(session.updatedAtMs).toISOString(),
      completedAt: toIso(session.completedAtMs),
      timeoutAt: new Date(session.timeoutAtMs).toISOString(),
      validationUrl: session.validationUrl,
      qrCodeDataUrl: session.qrCodeDataUrl,
      errors: [...session.errors],
      userPayload: (session.bridgeSession?.user as Record<string, unknown> | undefined) ?? null,
      bridgeSession: session.bridgeSession,
      pollIntervalMs: POLL_INTERVAL_MS,
    };
  }
}

export const qrCodeLoginManager = new QRCodeLoginManager();
