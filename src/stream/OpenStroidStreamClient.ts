import type { StreamClientConfig, StreamRealtimeStats } from '../types';
import { GamepadController } from './GamepadController';
import {
  MIN_STREAM_BITRATE_MBPS,
  resolutionForPreset,
  type StreamEncodingPreset,
  type StreamQualityPreset,
  type StreamResolutionPreset,
} from './streamOptions';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

const LOW_LATENCY_MOUSE_MOVE_DELAY_MS = 8;
const POINTER_LOCK_REQUEST_COOLDOWN_MS = 350;
const POINTER_LOCK_REQUEST_FALLBACK_TIMEOUT_MS = 500;
const CURSOR_MISS_COOLDOWN_MS = 5000;

type StreamStatus =
  | 'Preparing'
  | 'Opening control socket'
  | 'Control socket connected'
  | 'Starting WebRTC'
  | 'Streaming'
  | 'Disconnected'
  | 'Connection degraded';

type LogHandler = (message: string) => void;
type StatusHandler = (status: StreamStatus | string) => void;
export type StreamMouseMode = 'absolute' | 'relative';
type StreamVideoCodec = 'h264' | 'av1';

export interface StreamCursorState {
  x: number;
  y: number;
  visible: boolean;
  imageUrl?: string | null;
  offsetX?: number;
  offsetY?: number;
  name?: string;
}

type CursorHandler = (cursor: StreamCursorState) => void;
type MouseModeHandler = (mode: StreamMouseMode) => void;
type StatsHandler = (stats: StreamRealtimeStats) => void;
type ControllerCountHandler = (count: number) => void;

interface StreamClientOptions {
  videoElement: HTMLVideoElement;
  audioElement?: HTMLAudioElement;
  onLog?: LogHandler;
  onStatus?: StatusHandler;
  onCursor?: CursorHandler;
  onMouseMode?: MouseModeHandler;
  onStats?: StatsHandler;
  onControllerCount?: ControllerCountHandler;
}

interface StreamRuntimeSettings {
  maxBitrateMbps: number;
  maxFramerate: 60 | 120;
  resolution: StreamResolutionPreset;
  encoding: StreamEncodingPreset;
  fsrEnabled: boolean;
  microphoneEnabled: boolean;
  hdrEnabled: boolean;
  fillerEnabled: boolean;
  quality: StreamQualityPreset;
}

interface VideoSurfaceMetrics {
  left: number;
  top: number;
  cssWidth: number;
  cssHeight: number;
  visualSurfaceWidth: number;
  visualSurfaceHeight: number;
  surfaceWidth: number;
  surfaceHeight: number;
  movementScaleX: number;
  movementScaleY: number;
  devicePixelRatio: number;
}

interface PendingMouseMove {
  x: number;
  y: number;
  surfaceWidth: number;
  surfaceHeight: number;
}

type GatewayCandidate = string | { address?: unknown; gw?: unknown; gateway?: unknown; url?: unknown };

function now() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function normalizeGatewayHost(gateway: string) {
  return gateway.replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '').split('/')[0].trim();
}

function normalizeQuery(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Stream query is required.');
  return trimmed.startsWith('?') ? trimmed.slice(1) : trimmed;
}

function firstGatewayValue(value: GatewayCandidate): string | null {
  if (typeof value === 'string') return value;
  const candidate = value.address ?? value.gw ?? value.gateway ?? value.url;
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return atob(padded);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(decodeBase64Url(payload), (char) => char.charCodeAt(0)))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sessionIdFromQuery(query: string) {
  const params = new URLSearchParams(query);
  const fromParams = params.get('sessionId') ?? params.get('sessionid') ?? params.get('session');
  if (fromParams) return fromParams;
  const payload = decodeJwtPayload(query);
  const fromJwt = payload?.sessionId ?? payload?.sid ?? payload?.session_id;
  return typeof fromJwt === 'string' ? fromJwt : '';
}

function isGatewayQuery(query: string) {
  return query.includes('.') || query.includes('&') || /token|signature|hash|nickName|language/i.test(query);
}

function detectPlatformCode() {
  const source = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (source.includes('mac')) return 'mac';
  if (source.includes('linux')) return 'lin';
  if (source.includes('android')) return 'a';
  return 'win';
}

function mapKeyCode(event: KeyboardEvent) {
  if (event.keyCode === 16) return event.location === 1 ? 0xa0 : 0xa1;
  if (event.keyCode === 17) return event.location === 1 ? 0xa2 : 0xa3;
  if (event.keyCode === 18) return event.location === 1 ? 0xa4 : 0xa5;
  return event.keyCode || event.which || 0;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function connectionType() {
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  return connection?.effectiveType ?? 'unknown';
}

let av1SupportPromise: Promise<boolean> | null = null;

async function supportsAv1Decoding() {
  if (!navigator.mediaCapabilities?.decodingInfo) return false;
  av1SupportPromise ??= navigator.mediaCapabilities.decodingInfo({
    type: 'media-source',
    video: {
      contentType: 'video/webm; codecs=av01.0.08M.08',
      width: Math.max(window.screen.width || 0, window.innerWidth || 0, 1280),
      height: Math.max(window.screen.height || 0, window.innerHeight || 0, 720),
      bitrate: 40_000_000,
      framerate: 60,
    },
  }).then((result) => Boolean(result.supported && result.smooth)).catch(() => false);
  return av1SupportPromise;
}

function numberFromMessage(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function surfaceAspect(width: number, height: number) {
  return width > 0 && height > 0 ? width / height : 0;
}

function isAspectCompatible(width: number, height: number, targetAspect: number) {
  const aspect = surfaceAspect(width, height);
  if (!aspect || !targetAspect) return true;
  return Math.abs(aspect - targetAspect) / targetAspect <= 0.08;
}

function isPromiseLike(value: unknown): value is Promise<void> {
  return Boolean(value) && typeof (value as Promise<void>).then === 'function';
}

function toLandscapeResolution(width: number, height: number) {
  const normalizedWidth = Math.max(Number(width) || 0, Number(height) || 0);
  const normalizedHeight = Math.min(Number(width) || 0, Number(height) || 0);

  if (!Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight) || normalizedWidth <= 0 || normalizedHeight <= 0) {
    return { width: 1920, height: 1080 };
  }

  return {
    width: Math.round(normalizedWidth),
    height: Math.round(normalizedHeight),
  };
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function inflateCursorResource(resource: string) {
  const decompressionStream = (globalThis as typeof globalThis & {
    DecompressionStream?: new (format: CompressionFormat) => TransformStream<Uint8Array, Uint8Array>;
  }).DecompressionStream;
  if (!decompressionStream) return null;

  for (const format of ['deflate', 'deflate-raw', 'gzip'] as CompressionFormat[]) {
    try {
      const stream = new Blob([base64ToBytes(resource)]).stream().pipeThrough(new decompressionStream(format));
      const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
      return inflated;
    } catch {
      continue;
    }
  }

  return null;
}

// Returns the raw CUR resource as plain base64 (the official client feeds this
// directly into a `url(data:application/cur;base64,...)` CSS cursor value).
async function decodeCursorResource(resource: unknown, zipped: unknown) {
  if (typeof resource !== 'string' || !resource.trim()) return null;
  const trimmed = resource.trim();

  if (zipped !== true) return trimmed;

  const inflated = await inflateCursorResource(trimmed);
  return inflated ? bytesToBase64(inflated) : null;
}

function normalizeWebRtcApiHost(gatewayHost: string) {
  return gatewayHost.split(':')[0];
}

function filterAllowedCodecs(sdp: string, allowedCodecs: string[]) {
  if (!sdp || allowedCodecs.length === 0) return sdp;

  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const normalizedAllowed = allowedCodecs
    .map((entry) => {
      const [type, codec] = entry.split('/');
      if (!type || !codec) return null;
      return { type: type.toLowerCase(), codec: codec.toLowerCase() };
    })
    .filter((entry): entry is { type: string; codec: string } => Boolean(entry));

  const lines = sdp.split(eol);
  const sections: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith('m=')) {
      if (current.length) sections.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) sections.push(current);

  return sections
    .map((section) => {
      const firstLine = section[0];
      if (!firstLine?.startsWith('m=')) return section.join(eol);

      const mediaType = firstLine.split(' ')[0].slice(2);
      if (mediaType !== 'audio' && mediaType !== 'video') return section.join(eol);

      const codecMap = new Map<string, string>();
      const fmtpMap = new Map<string, string>();
      const rtxAssociations = new Map<string, string>();
      const redundancyAssociations = new Map<string, string[]>();

      for (const line of section) {
        if (line.startsWith('a=rtpmap:')) {
          const payload = line.substring(9).split(' ')[0].trim();
          const codec = line.substring(9).split(' ')[1]?.split('/')[0]?.toLowerCase();
          if (payload && codec) codecMap.set(payload, codec);
          continue;
        }

        if (!line.startsWith('a=fmtp:')) continue;
        const fmtpBody = line.substring(7).trim();
        const spaceIdx = fmtpBody.indexOf(' ');
        if (spaceIdx === -1) continue;
        const payload = fmtpBody.substring(0, spaceIdx).trim();
        const params = fmtpBody.substring(spaceIdx + 1);
        fmtpMap.set(payload, params);

        const aptMatch = params.match(/apt=(\d+)/i);
        if (aptMatch) {
          rtxAssociations.set(payload, aptMatch[1]);
          continue;
        }

        if (/^\d+(?:\/\d+)+$/i.test(params.trim())) {
          redundancyAssociations.set(payload, params.trim().split('/'));
        }
      }

      const allowedPayloads = new Set<string>();
      codecMap.forEach((codec, payload) => {
        if (codec === 'rtx') return;
        if (normalizedAllowed.some((allowed) => allowed.type === mediaType && allowed.codec === codec)) {
          allowedPayloads.add(payload);
        }
      });

      for (const [payload, params] of fmtpMap.entries()) {
        const fmtp = params.toLowerCase();
        if (codecMap.get(payload) === 'h264') {
          const profile = fmtp.match(/profile-level-id=([0-9a-f]{6})/i);
          if (profile && parseInt(profile[1].substring(0, 2), 16) >= 0x64) {
            allowedPayloads.delete(payload);
            continue;
          }
          const packetizationMode = fmtp.match(/packetization-mode=([0-9]+)/i);
          if (packetizationMode && parseInt(packetizationMode[1], 10) === 0) {
            allowedPayloads.delete(payload);
            continue;
          }
        }

        if (codecMap.get(payload) === 'av1') {
          const profile = fmtp.match(/profile=([0-9]+)/i);
          if (profile && parseInt(profile[1], 10) !== 0) {
            allowedPayloads.delete(payload);
          }
        }
      }

      rtxAssociations.forEach((primary, rtxPayload) => {
        if (allowedPayloads.has(primary)) allowedPayloads.add(rtxPayload);
      });
      redundancyAssociations.forEach((primaries, redundantPayload) => {
        if (primaries.every((payload) => allowedPayloads.has(payload))) allowedPayloads.add(redundantPayload);
      });

      if (!allowedPayloads.size) return section.join(eol);

      const orderedPayloads: string[] = [];
      for (const allowed of normalizedAllowed) {
        codecMap.forEach((codec, payload) => {
          if (allowed.type === mediaType && allowed.codec === codec && allowedPayloads.has(payload)) {
            orderedPayloads.push(payload);
          }
        });
      }
      codecMap.forEach((_codec, payload) => {
        if (allowedPayloads.has(payload) && !orderedPayloads.includes(payload)) orderedPayloads.push(payload);
      });

      const mParts = firstLine.split(' ');
      const filtered = [[...mParts.slice(0, 3), ...orderedPayloads].join(' ')];
      for (const line of section.slice(1)) {
        if (line.startsWith('a=rtpmap:') || line.startsWith('a=fmtp:') || line.startsWith('a=rtcp-fb:')) {
          const payload = line.substring(line.indexOf(':') + 1).split(' ')[0].trim();
          if (!allowedPayloads.has(payload)) continue;
        }
        filtered.push(line);
      }

      return filtered.join(eol);
    })
    .join(eol);
}

export class OpenStroidStreamClient {
  private readonly videoElement: HTMLVideoElement;
  private readonly audioElement: HTMLAudioElement;
  private readonly onLog: LogHandler;
  private readonly onStatus: StatusHandler;
  private readonly onCursor: CursorHandler;
  private readonly onMouseMode: MouseModeHandler;
  private readonly onStats: StatsHandler;
  private readonly onControllerCount: ControllerCountHandler;
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private currentConfig: StreamClientConfig | null = null;
  private sessionId = '';
  private sessionQuery = '';
  private gatewayHost = '';
  private webrtcApiBase = '';
  private peerId = '';
  private preferredCodec: StreamEncodingPreset = 'h264';
  private activeCodec: StreamVideoCodec = 'h264';
  private gatewayCodec = '';
  private gateways: unknown[] = [];
  private remoteIceTimer: number | null = null;
  private statsTimer: number | null = null;
  private remoteIceDedup = new Set<string>();

  // === Mouse / cursor pipeline state (mirrors the official EventHandler + CursorModeManager, Legacy mode) ===
  // 1 = inactive, 2 = active + absolute transport, 3 = active + relative transport.
  private cursorState: 1 | 2 | 3 = 1;
  private lastCursorState: 0 | 2 | 3 = 0;
  private transportMode: StreamMouseMode = 'absolute';
  private cursorPosition = { x: 0.5, y: 0.5 };
  private pendingActivationPosition: { x: number; y: number } | null = null;
  private pendingActivationPositionRequiresSync = false;
  private relativeMovementRemainder = { x: 0, y: 0 };
  private pendingMouseMove: PendingMouseMove | null = null;
  private pendingMovementX = 0;
  private pendingMovementY = 0;
  private mouseMoveRaf: number | null = null;
  private mouseMoveTimer: number | null = null;
  private videoSurfaceMetrics: VideoSurfaceMetrics | null = null;
  private videoSurfaceMetricsDirty = true;
  private pointerLockRequestedAt = 0;
  private isPointerLockRequestPending = false;
  private pointerLockRequestTimeoutIds = new Set<number>();
  // Cursor resources are raw CUR base64, applied via CSS url(data:application/cur;base64,...).
  private cursorResources = new Map<string, string>();
  private cursorMissCooldowns = new Map<string, number>();
  private currentCursorName = 'default';
  private lastCursorIconName: string | null = null;
  private baseInputInstalled = false;
  private mouseInputInstalled = false;
  private gamepadController: GamepadController | null = null;

  private cursor: StreamCursorState = { x: 0.5, y: 0.5, visible: false, imageUrl: null };
  private pressedKeys = new Set<number>();
  private eventCount = 0;
  private idCmdCounter = 0;
  private statsPrev: {
    timestamp: number;
    bytesReceived: number;
    framesDecoded: number;
    framesReceived: number;
    packetsReceived: number;
    packetsLost: number;
  } | null = null;
  private runtimeSettings: StreamRuntimeSettings = {
    maxBitrateMbps: 20,
    maxFramerate: 60,
    resolution: 'auto',
    encoding: 'h264',
    fsrEnabled: false,
    microphoneEnabled: false,
    hdrEnabled: false,
    fillerEnabled: false,
    quality: 'auto',
  };

  constructor(options: StreamClientOptions) {
    this.videoElement = options.videoElement;
    this.audioElement = options.audioElement ?? new Audio();
    this.onLog = options.onLog ?? (() => undefined);
    this.onStatus = options.onStatus ?? (() => undefined);
    this.onCursor = options.onCursor ?? (() => undefined);
    this.onMouseMode = options.onMouseMode ?? (() => undefined);
    this.onStats = options.onStats ?? (() => undefined);
    this.onControllerCount = options.onControllerCount ?? (() => undefined);
  }

  setAudioVolume(volume: number) {
    const normalized = Math.min(Math.max(Math.round(volume), 0), 100);
    this.audioElement.volume = normalized / 100;
    this.audioElement.muted = normalized === 0;
    return normalized;
  }

  setMuted(muted: boolean) {
    this.audioElement.muted = muted;
    return this.audioElement.muted;
  }

  setQuality(quality: StreamQualityPreset) {
    this.runtimeSettings.quality = quality;
  }

  setMaxBitrateMbps(value: number) {
    const maxBitrateMbps = Math.max(Math.round(value), MIN_STREAM_BITRATE_MBPS);
    this.runtimeSettings.maxBitrateMbps = maxBitrateMbps;
    this.sendEvent({
      type: 'stream',
      action: 'bitrate_max',
      value: maxBitrateMbps * 1_000_000,
    });
    this.log(`Max bitrate set to ${maxBitrateMbps} Mbps`);
    return maxBitrateMbps;
  }

  setMaxFramerate(value: number) {
    const maxFramerate = value >= 120 ? 120 : 60;
    this.runtimeSettings.maxFramerate = maxFramerate;
    this.sendEvent({ type: 'stream', action: 'refreshRate', value: maxFramerate });
    this.log(`Max refresh rate set to ${maxFramerate} FPS`);
    return maxFramerate;
  }

  setResolutionPreset(value: StreamResolutionPreset) {
    this.runtimeSettings.resolution = value;
    const resolution = this.resolveResolution();
    this.sendEvent({ type: 'stream', action: 'screenSize', value: resolution });
    this.invalidateVideoSurfaceMetrics();
    this.log(`Resolution set to ${value === 'auto' ? `auto (${resolution.width}x${resolution.height})` : `${resolution.width}x${resolution.height}`}`);
    return resolution;
  }

  setEncoding(value: StreamEncodingPreset) {
    this.runtimeSettings.encoding = value;
    this.preferredCodec = value;
    this.log(`Encoding set to ${value === 'h264' ? 'H.264' : value.toUpperCase()}`);
    return value;
  }

  setFsrEnabled(enabled: boolean) {
    this.runtimeSettings.fsrEnabled = enabled;
    this.sendEvent({ type: 'stream', action: 'fsr', value: enabled });
    this.log(`FSR ${enabled ? 'enabled' : 'disabled'}`);
  }

  setMicrophoneEnabled(enabled: boolean) {
    this.runtimeSettings.microphoneEnabled = enabled;
    this.sendEvent({ type: 'settings', action: 'microphone', value: enabled });
    this.log(`Microphone ${enabled ? 'enabled' : 'disabled'}`);
  }

  sendClipboardPaste(text: string) {
    if (!text) return;
    this.sendEvent({ type: 'clipboard', action: 'paste', value: text });
    this.log(`Sent clipboard paste payload length=${text.length}`);
  }

  getRuntimeSettings() {
    return { ...this.runtimeSettings };
  }

  async reconnect() {
    if (!this.currentConfig) {
      throw new Error('No previous stream launch config is available.');
    }
    this.log('Manual reconnect requested');
    await this.connect(this.currentConfig);
  }

  async connect(config: StreamClientConfig) {
    await this.disconnect(true);
    this.currentConfig = config;
    this.log(`Launch config: session=${config.sessionId} gateways=${config.gateways?.length ?? 0} queries=${config.sessionQueries?.length ?? 0}`);
    const queries = (config.sessionQueries ?? []).filter((query) => typeof query === 'string' && query.trim());
    if (config.sessionQuery) queries.unshift(config.sessionQuery);
    const normalizedQueries = queries.map(normalizeQuery);
    const query =
      normalizedQueries.find((candidate) => sessionIdFromQuery(candidate) === config.sessionId && isGatewayQuery(candidate)) ??
      normalizedQueries.find(isGatewayQuery) ??
      normalizedQueries.find((candidate) => sessionIdFromQuery(candidate) === config.sessionId) ??
      normalizedQueries[0];
    if (!query) throw new Error('Boosteroid did not return a stream gateway query.');

    this.sessionId = config.sessionId || sessionIdFromQuery(query);
    this.sessionQuery = query;
    this.preferredCodec = this.runtimeSettings.encoding;
    this.gateways = config.gateways ?? [];

    this.setStatus('Preparing');
    this.log(`Session ${this.sessionId}`);
    this.gatewayHost = normalizeGatewayHost(await this.resolveGateway(config.homeUrl));
    this.webrtcApiBase = `https://${normalizeWebRtcApiHost(this.gatewayHost)}/webrtc`;
    this.log(`Resolved gateway ${this.gatewayHost}; queryLength=${this.sessionQuery.length}`);

    await this.openControlWebSocket();
    this.installBaseInputHandlers();
  }

  async disconnect(silent = false) {
    this.fullInputRelease('disconnect');
    this.uninstallBaseInputHandlers();
    this.stopStatsLoop();
    this.stopRemoteIcePolling();

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendEvent({ type: 'settings', action: 'terminating' });
    }
    this.ws?.close(1000, 'Disconnected by OpenStroid');
    this.ws = null;

    this.dataChannel?.close();
    this.dataChannel = null;
    this.pc?.close();
    this.pc = null;

    if (this.webrtcApiBase && this.peerId && this.sessionId) {
      const url = `${this.webrtcApiBase}/api/hangup?peerid=${encodeURIComponent(this.peerId)}&sessionId=${encodeURIComponent(this.sessionId)}`;
      fetch(url).catch(() => undefined);
    }

    this.peerId = '';
    this.remoteIceDedup.clear();
    this.statsPrev = null;

    this.transportMode = 'absolute';
    this.cursorState = 1;
    this.lastCursorState = 0;
    this.cursorPosition = { x: 0.5, y: 0.5 };
    this.currentCursorName = 'default';
    this.lastCursorIconName = null;
    this.cursorMissCooldowns.clear();
    this.videoSurfaceMetrics = null;
    this.videoSurfaceMetricsDirty = true;
    this.onMouseMode(this.transportMode);
    this.emitCursorState();
    if (!silent) this.setStatus('Disconnected');
  }

  private async resolveGateway(homeUrl: string) {
    const fromLaunch = this.gateways.map((item) => firstGatewayValue(item as GatewayCandidate)).find((item): item is string => Boolean(item));
    if (fromLaunch) return fromLaunch;

    const response = await fetch(`${normalizeBaseUrl(homeUrl)}/api/v1/streaming/gateways`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Gateway lookup failed (${response.status}).`);
    const payload = (await response.json()) as { data?: GatewayCandidate[] };
    const first = (Array.isArray(payload) ? payload : payload.data ?? []).map(firstGatewayValue).find((item): item is string => Boolean(item));
    if (!first) throw new Error('Boosteroid returned no streaming gateways.');
    return first;
  }

  private async selectedCodec() {
    if (this.preferredCodec === 'h264') return 'h264';
    if (await supportsAv1Decoding()) return 'av1';
    if (this.preferredCodec === 'av1') this.log('AV1 is not supported by this browser; falling back to H.264');
    return 'h264';
  }

  private resolveResolution() {
    const preset = resolutionForPreset(this.runtimeSettings.resolution);
    if (preset?.width && preset.height) {
      return { width: preset.width, height: preset.height };
    }

    return toLandscapeResolution(
      Math.max(1280, Math.round(window.innerWidth * window.devicePixelRatio)),
      Math.max(720, Math.round(window.innerHeight * window.devicePixelRatio)),
    );
  }

  private async openControlWebSocket() {
    const codec = await this.selectedCodec();
    this.activeCodec = codec;
    const { width, height } = this.resolveResolution();
    const params = new URLSearchParams({
      x: String(width),
      y: String(height),
      lang: 'en',
      refreshRate: String(this.runtimeSettings.maxFramerate),
      rtcEngine: 'webrtc',
      clientType: 'web',
      devType: 'desktop',
      os: detectPlatformCode(),
      rtcAudio: 'pcm',
    });
    if (codec === 'av1') params.set('codec', 'av1');
    const wsUrl = `wss://${this.gatewayHost}/?${this.sessionQuery}&${params.toString()}`;

    this.setStatus('Opening control socket');
    this.log(`Opening control socket on ${this.gatewayHost}; codec=${codec} resolution=${width}x${height}`);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        settled = true;
        this.setStatus('Control socket connected');
        this.log('Control socket connected');
        resolve();
      };
      ws.onerror = () => {
        this.log('Control socket error');
        if (!settled) reject(new Error('Control socket failed to open.'));
        this.setStatus('Connection degraded');
      };
      ws.onclose = (event) => {
        this.log(`Control socket closed (${event.code})`);
        this.setStatus('Disconnected');
      };
      ws.onmessage = (event) => {
        void this.handleControlMessage(String(event.data));
      };
    });
  }

  private async handleControlMessage(rawMessage: string) {
    const message = parseJson(rawMessage);
    if (!message) {
      this.log(`Non-JSON control frame: ${rawMessage.slice(0, 80)}`);
      return;
    }

    if (message.type === 'settings' && message.action === 'webrtc') {
      await this.startWebRtcTransport();
      return;
    }

    if (message.type === 'stream' && message.action === 'getstatus') {
      this.sendGatewayStatus();
      return;
    }

    if (message.type === 'stream' && message.action === 'setstatus') {
      const value = message.value && typeof message.value === 'object'
        ? message.value as Record<string, unknown>
        : {};
      if (typeof value.codec === 'string') this.gatewayCodec = value.codec;
      if (typeof value.hdr === 'boolean') this.runtimeSettings.hdrEnabled = value.hdr;
      if (typeof value.framerate === 'number') {
        this.runtimeSettings.maxFramerate = value.framerate >= 120 ? 120 : 60;
      }
      if (typeof value.fsr === 'boolean') this.runtimeSettings.fsrEnabled = value.fsr;
      this.log(`Gateway status updated codec=${this.gatewayCodec || 'unknown'} fps=${this.runtimeSettings.maxFramerate}`);
      return;
    }

    if (message.type === 'cursor') {
      await this.handleRemoteCursor(message);
      return;
    }

    if (message.type === 'mouse' || message.type === 'keyboard') {
      // Input echoes are only used for RTT measurement by the official client.
      return;
    }

    if (message.type === 'controller') {
      this.gamepadController?.handleServerMessage(message);
      return;
    }

    if (message.type === 'settings' && message.action === 'streamIds') {
      this.log('Received legacy Janus streamIds message; WebRTC path is active for this build.');
      return;
    }

    this.log(`Control: ${JSON.stringify(message).slice(0, 300)}`);
  }

  // === Server-driven cursor state (official CursorHandler.validateCursorDataJSON) ===

  private async handleRemoteCursor(message: Record<string, unknown>) {
    const name = typeof message.name === 'string' && message.name ? message.name : null;

    if (name && message.resource) {
      const resource = await decodeCursorResource(message.resource, message.zipped);
      if (resource) {
        this.cursorResources.set(name, resource);
        this.cursorMissCooldowns.delete(name);
      }
    }

    this.syncServerCursorState(message);

    if (name) {
      this.changeSessionCursor(name);
    } else if (this.cursorState > 1) {
      this.refreshSessionCursor();
    }

    this.emitCursorState();
  }

  // Mirrors CursorModeManager.syncServerCursorState (Legacy branch).
  private syncServerCursorState(message: Record<string, unknown>) {
    const explicitX = numberFromMessage(message.X);
    const explicitY = numberFromMessage(message.Y);
    const receivedExplicitPosition = explicitX !== null || explicitY !== null;
    const previousTransport = this.transportMode;

    if (typeof message.isVisible === 'boolean') {
      this.setTransportMode(message.isVisible ? 'absolute' : 'relative');
    }

    let nextX = explicitX ?? this.cursorPosition.x;
    let nextY = explicitY ?? this.cursorPosition.y;

    if (receivedExplicitPosition && this.pendingActivationPosition) {
      this.consumePendingActivationPosition();
    }

    const pendingActivationPosition = this.pendingActivationPosition;
    const switchedToAbsolute = previousTransport === 'relative' && this.transportMode === 'absolute';
    const shouldApplyPendingActivationPosition =
      this.cursorState !== 1 &&
      this.transportMode === 'absolute' &&
      pendingActivationPosition !== null &&
      !receivedExplicitPosition &&
      (switchedToAbsolute || this.pendingActivationPositionRequiresSync);

    if (shouldApplyPendingActivationPosition && pendingActivationPosition) {
      nextX = pendingActivationPosition.x;
      nextY = pendingActivationPosition.y;
      this.consumePendingActivationPosition();
    } else if (switchedToAbsolute) {
      if (explicitX === null) nextX = 0.5;
      if (explicitY === null) nextY = 0.5;
    }

    this.cursorPosition = { x: nextX, y: nextY };
    this.lastCursorState = this.getCursorStateForActiveCapture();

    if (this.cursorState !== 1) {
      this.cursorState = this.getCursorStateForActiveCapture();
      if (this.shouldUsePointerLock()) {
        this.requestPointerLock('server-state');
      } else {
        this.exitPointerLockIfHeld();
      }
    }
  }

  // === Legacy cursor rendering (official CursorHandler.changeSessionCursor) ===

  private refreshSessionCursor() {
    this.changeSessionCursor(this.lastCursorIconName ?? 'default');
  }

  private changeSessionCursor(cursorName: string) {
    if (this.cursorState < 2) {
      this.currentCursorName = 'default';
      this.videoElement.style.cursor = 'default';
      return;
    }

    const resolvedCursorName = cursorName || 'default';
    this.currentCursorName = resolvedCursorName;

    if (resolvedCursorName === 'none') {
      this.videoElement.style.cursor = 'none';
      return;
    }

    if (resolvedCursorName === 'default') {
      this.videoElement.style.cursor = this.shouldHideLocalCursor(resolvedCursorName) ? 'none' : 'default';
      return;
    }

    const cursorResource = this.cursorResources.get(resolvedCursorName) ?? null;
    if (cursorResource) {
      this.lastCursorIconName = resolvedCursorName;
      this.cursorMissCooldowns.delete(resolvedCursorName);
    } else {
      this.requestMissingCursor(resolvedCursorName);
    }

    if (this.shouldHideLocalCursor(resolvedCursorName)) {
      this.videoElement.style.cursor = 'none';
      return;
    }

    // Official Legacy path keeps the previous cursor while a missed resource is in flight.
    if (cursorResource) {
      this.videoElement.style.cursor = `url(data:application/cur;base64,${cursorResource}),auto`;
    }
  }

  private shouldHideLocalCursor(cursorName: string) {
    if (this.cursorState === 1) return false;
    if (cursorName === 'none') return true;
    return this.transportMode === 'relative';
  }

  private requestMissingCursor(cursorName: string) {
    const timestamp = Date.now();
    const lastRequestAt = this.cursorMissCooldowns.get(cursorName) ?? 0;
    if (timestamp - lastRequestAt < CURSOR_MISS_COOLDOWN_MS) return;
    this.cursorMissCooldowns.set(cursorName, timestamp);
    this.sendInputEvent({ type: 'cursor', action: 'missed', name: cursorName });
  }

  // The native CSS cursor renders the remote cursor, so `visible` is always false; the
  // onCursor callback only reports state for optional UI consumers.
  private emitCursorState() {
    const resource =
      this.cursorState === 2 && this.currentCursorName !== 'none' && this.currentCursorName !== 'default'
        ? this.cursorResources.get(this.currentCursorName) ?? null
        : null;
    this.cursor = {
      x: clamp01(this.cursorPosition.x),
      y: clamp01(this.cursorPosition.y),
      visible: false,
      imageUrl: resource ? `data:application/cur;base64,${resource}` : null,
      name: this.currentCursorName,
    };
    this.onCursor(this.cursor);
  }

  // === Cursor state machine ===

  private getCursorStateForActiveCapture(): 2 | 3 {
    return this.transportMode === 'relative' ? 3 : 2;
  }

  private setTransportMode(mode: StreamMouseMode) {
    if (this.transportMode === mode) return false;
    this.transportMode = mode;
    this.resetRelativeMovementRemainder();
    this.onMouseMode(mode);
    return true;
  }

  private resetRelativeMovementRemainder() {
    this.relativeMovementRemainder.x = 0;
    this.relativeMovementRemainder.y = 0;
  }

  private consumePendingActivationPosition() {
    const pendingActivationPosition = this.pendingActivationPosition;
    this.pendingActivationPosition = null;
    this.pendingActivationPositionRequiresSync = false;
    return pendingActivationPosition;
  }

  private captureActivationCursorPosition(event: MouseEvent) {
    const point = this.buildNormalizedPoint(event.clientX, event.clientY);
    if (!point) {
      this.pendingActivationPosition = null;
      this.pendingActivationPositionRequiresSync = false;
      return;
    }
    this.pendingActivationPosition = { x: clamp01(point.x), y: clamp01(point.y) };
    this.pendingActivationPositionRequiresSync = true;
  }

  private activateInput() {
    const desiredState = this.lastCursorState > 1 ? this.lastCursorState : 2;
    this.setTransportMode(desiredState === 3 ? 'relative' : 'absolute');
    this.cursorState = this.getCursorStateForActiveCapture();
    this.lastCursorState = this.cursorState;

    if (this.pendingActivationPosition && this.transportMode === 'absolute') {
      this.cursorPosition = { ...this.pendingActivationPosition };
    }

    if (this.shouldUsePointerLock()) {
      this.requestPointerLock('activate');
    } else {
      this.exitPointerLockIfHeld();
    }

    this.emitCursorState();
  }

  private fullInputRelease(reason: string) {
    this.resetPendingMouseMove();
    this.releasePressedKeys(reason);
    this.lastCursorState = this.getCursorStateForActiveCapture();
    this.cursorState = 1;
    this.resetRelativeMovementRemainder();
    this.pendingActivationPosition = null;
    this.pendingActivationPositionRequiresSync = false;
    this.isPointerLockRequestPending = false;
    this.clearPointerLockRequestTimeouts();
    this.exitPointerLockIfHeld();
    this.uninstallMouseInputHandlers();
    this.refreshSessionCursor();
    this.emitCursorState();
  }

  // === Input activation / listener management ===

  private handleVideoClick = (event: MouseEvent) => {
    this.videoElement.focus();
    if (this.cursorState !== 1) return;
    this.captureActivationCursorPosition(event);
    this.initMouseInput();
  };

  private initMouseInput() {
    if (this.mouseInputInstalled) {
      this.activateInput();
      this.refreshSessionCursor();
      return;
    }
    this.mouseInputInstalled = true;

    // Activation handshake (official initKeyboardAndMouse).
    this.sendInputEvent({ type: 'cursor', action: 'missed' });
    this.sendInputEvent({
      type: 'mouse',
      action: 'connected',
      LeftBtnState: false,
      MiddleBtnState: false,
      RightBtnState: false,
    });

    const target = this.videoElement;
    target.addEventListener('mousemove', this.handleMouseMove);
    target.addEventListener('mousedown', this.handleMouseButton);
    target.addEventListener('mouseup', this.handleMouseButton);
    target.addEventListener('wheel', this.handleWheel, { passive: true });
    target.addEventListener('contextmenu', this.handleContextMenu);

    this.activateInput();
    this.refreshSessionCursor();
    this.log('Mouse input activated');
  }

  private uninstallMouseInputHandlers() {
    if (!this.mouseInputInstalled) return;
    this.mouseInputInstalled = false;
    const target = this.videoElement;
    target.removeEventListener('mousemove', this.handleMouseMove);
    target.removeEventListener('mousedown', this.handleMouseButton);
    target.removeEventListener('mouseup', this.handleMouseButton);
    target.removeEventListener('wheel', this.handleWheel);
    target.removeEventListener('contextmenu', this.handleContextMenu);
  }

  private installBaseInputHandlers() {
    if (this.baseInputInstalled) return;
    this.baseInputInstalled = true;
    const target = this.videoElement;
    target.tabIndex = 0;

    target.addEventListener('click', this.handleVideoClick);
    target.addEventListener('loadedmetadata', this.invalidateVideoSurfaceMetrics);
    target.addEventListener('resize', this.invalidateVideoSurfaceMetrics);
    window.addEventListener('resize', this.invalidateVideoSurfaceMetrics);
    window.addEventListener('scroll', this.invalidateVideoSurfaceMetrics, true);
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('focus', this.handleWindowFocus);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('wheel', this.handlePreventCtrlWheelZoom, { passive: false });
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', this.handlePointerLockError);

    this.sendInputEvent({ type: 'keyboard', action: 'connected' });
    this.startGamepadInput();
  }

  private startGamepadInput() {
    this.stopGamepadInput();
    this.gamepadController = new GamepadController({
      sendEvent: (data) => this.sendRttEvent(data),
      detectPlatform: detectPlatformCode,
      onActiveCountChange: (count) => this.onControllerCount(count),
      onRelease: () => this.fullInputRelease('controller combo'),
    });
    this.gamepadController.start();
  }

  private stopGamepadInput() {
    this.gamepadController?.stop();
    this.gamepadController = null;
    this.onControllerCount(0);
  }

  private uninstallBaseInputHandlers() {
    if (!this.baseInputInstalled) return;
    this.baseInputInstalled = false;
    this.stopGamepadInput();
    const target = this.videoElement;
    target.removeEventListener('click', this.handleVideoClick);
    target.removeEventListener('loadedmetadata', this.invalidateVideoSurfaceMetrics);
    target.removeEventListener('resize', this.invalidateVideoSurfaceMetrics);
    window.removeEventListener('resize', this.invalidateVideoSurfaceMetrics);
    window.removeEventListener('scroll', this.invalidateVideoSurfaceMetrics, true);
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('focus', this.handleWindowFocus);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('wheel', this.handlePreventCtrlWheelZoom);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('pointerlockerror', this.handlePointerLockError);
  }

  // === Video surface metrics (official EventHandler video surface metrics) ===

  private invalidateVideoSurfaceMetrics = () => {
    this.videoSurfaceMetricsDirty = true;
  };

  private resolveVideoContentSize() {
    const videoWidth = this.videoElement.videoWidth;
    const videoHeight = this.videoElement.videoHeight;
    if (videoWidth > 0 && videoHeight > 0) return { width: videoWidth, height: videoHeight };
    const resolution = this.resolveResolution();
    return resolution.width > 0 && resolution.height > 0 ? resolution : null;
  }

  private resolveInputSurfaceSize(cssWidth: number, cssHeight: number) {
    const targetAspect = surfaceAspect(cssWidth, cssHeight);
    const candidates = [
      this.resolveResolution(),
      { width: this.videoElement.videoWidth, height: this.videoElement.videoHeight },
    ];

    for (const candidate of candidates) {
      const width = Number(candidate.width) || 0;
      const height = Number(candidate.height) || 0;
      if (width > 0 && height > 0 && isAspectCompatible(width, height, targetAspect)) {
        return { width, height };
      }
    }

    return null;
  }

  private refreshVideoSurfaceMetrics(): VideoSurfaceMetrics | null {
    const rect = this.videoElement.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio || 1;

    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      this.videoSurfaceMetrics = null;
      this.videoSurfaceMetricsDirty = true;
      return null;
    }

    // Letterboxed content rect (CSS px) from the intrinsic video aspect.
    const contentSize = this.resolveVideoContentSize();
    const contentAspect = contentSize ? surfaceAspect(contentSize.width, contentSize.height) : 0;
    const elementAspect = surfaceAspect(rect.width, rect.height);
    let content = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };

    if (contentAspect && elementAspect && Math.abs(elementAspect - contentAspect) / contentAspect > 0.001) {
      if (elementAspect > contentAspect) {
        const width = rect.height * contentAspect;
        content = { left: rect.left + (rect.width - width) / 2, top: rect.top, width, height: rect.height };
      } else {
        const height = rect.width / contentAspect;
        content = { left: rect.left, top: rect.top + (rect.height - height) / 2, width: rect.width, height };
      }
    }

    const visualSurfaceWidth = content.width * devicePixelRatio;
    const visualSurfaceHeight = content.height * devicePixelRatio;
    const inputSurface = this.resolveInputSurfaceSize(content.width, content.height) ?? {
      width: visualSurfaceWidth,
      height: visualSurfaceHeight,
    };

    this.videoSurfaceMetrics = {
      left: content.left,
      top: content.top,
      cssWidth: content.width,
      cssHeight: content.height,
      visualSurfaceWidth,
      visualSurfaceHeight,
      surfaceWidth: inputSurface.width,
      surfaceHeight: inputSurface.height,
      movementScaleX: content.width > 0 ? inputSurface.width / content.width : devicePixelRatio,
      movementScaleY: content.height > 0 ? inputSurface.height / content.height : devicePixelRatio,
      devicePixelRatio,
    };
    this.videoSurfaceMetricsDirty = false;
    return this.videoSurfaceMetrics;
  }

  private getVideoSurfaceMetrics() {
    const devicePixelRatio = window.devicePixelRatio || 1;
    if (this.videoSurfaceMetrics && !this.videoSurfaceMetricsDirty && this.videoSurfaceMetrics.devicePixelRatio === devicePixelRatio) {
      return this.videoSurfaceMetrics;
    }
    return this.refreshVideoSurfaceMetrics();
  }

  private buildNormalizedPoint(clientX: number, clientY: number): PendingMouseMove | null {
    const metrics = this.getVideoSurfaceMetrics();
    if (!metrics) return null;

    const devicePixelRatio = window.devicePixelRatio || 1;
    const rawX = (clientX - metrics.left) * devicePixelRatio;
    const rawY = (clientY - metrics.top) * devicePixelRatio;

    return {
      x: clamp01(rawX / metrics.visualSurfaceWidth),
      y: clamp01(rawY / metrics.visualSurfaceHeight),
      surfaceWidth: metrics.surfaceWidth,
      surfaceHeight: metrics.surfaceHeight,
    };
  }

  private resolveMouseMovement(event: MouseEvent, metrics: VideoSurfaceMetrics) {
    const movementScaleX = metrics.movementScaleX || metrics.devicePixelRatio || 1;
    const movementScaleY = metrics.movementScaleY || metrics.devicePixelRatio || 1;
    return {
      movementX: (event.movementX || 0) * movementScaleX,
      movementY: (event.movementY || 0) * movementScaleY,
    };
  }

  // === Mouse move batching (official EventHandler.updatePosition + _sendBatchedMouseMove) ===

  private handleMouseMove = (event: MouseEvent) => {
    if (this.shouldBlockMouseMove()) return;
    const metrics = this.getVideoSurfaceMetrics();
    if (!metrics) return;

    const movement = this.resolveMouseMovement(event, metrics);
    const point = this.buildNormalizedPoint(event.clientX, event.clientY);
    if (!point) return;

    this.pendingMouseMove = point;
    this.pendingMovementX += movement.movementX;
    this.pendingMovementY += movement.movementY;
    this.scheduleMouseMoveFlush(this.shouldUseLowLatencyMouseMove());
  };

  private shouldBlockMouseMove() {
    if (this.transportMode !== 'relative') return false;
    return this.shouldUsePointerLock() && !this.isPointerLocked();
  }

  private shouldUseLowLatencyMouseMove() {
    return this.cursorState !== 1 && this.transportMode === 'relative' && this.isPointerLocked();
  }

  private scheduleMouseMoveFlush(useLowLatency: boolean) {
    if (useLowLatency) {
      if (this.mouseMoveRaf !== null) {
        cancelAnimationFrame(this.mouseMoveRaf);
        this.mouseMoveRaf = null;
      }
      if (this.mouseMoveTimer === null) {
        this.mouseMoveTimer = window.setTimeout(this.sendBatchedMouseMove, LOW_LATENCY_MOUSE_MOVE_DELAY_MS);
      }
      return;
    }

    if (this.mouseMoveTimer !== null) return;
    if (this.mouseMoveRaf === null) {
      this.mouseMoveRaf = window.requestAnimationFrame(this.sendBatchedMouseMove);
    }
  }

  private sendBatchedMouseMove = () => {
    this.mouseMoveRaf = null;
    this.mouseMoveTimer = null;
    if (!this.pendingMouseMove) return;

    const pending = this.pendingMouseMove;
    const data = this.buildMouseMoveData(pending, this.pendingMovementX, this.pendingMovementY);
    this.sendRttEvent(data);

    this.pendingMouseMove = null;
    this.pendingMovementX = 0;
    this.pendingMovementY = 0;
  };

  // Mirrors CursorModeManager.buildMouseMoveData (Legacy branch): trunc + remainder in
  // relative transport, full-float X/Y, Math.round on the wire offsets.
  private buildMouseMoveData(pending: PendingMouseMove, movementX: number, movementY: number): Record<string, unknown> {
    let offsetX = Number.isFinite(movementX) ? movementX : 0;
    let offsetY = Number.isFinite(movementY) ? movementY : 0;

    if (this.transportMode === 'relative') {
      const totalX = offsetX + this.relativeMovementRemainder.x;
      const totalY = offsetY + this.relativeMovementRemainder.y;
      offsetX = Math.trunc(totalX);
      offsetY = Math.trunc(totalY);
      this.relativeMovementRemainder.x = totalX - offsetX;
      this.relativeMovementRemainder.y = totalY - offsetY;
    } else {
      this.resetRelativeMovementRemainder();
    }

    const nextX = Number.isFinite(pending.x) ? pending.x : this.cursorPosition.x;
    const nextY = Number.isFinite(pending.y) ? pending.y : this.cursorPosition.y;

    if (
      this.pendingActivationPositionRequiresSync &&
      this.transportMode === 'absolute' &&
      (Number.isFinite(pending.x) || Number.isFinite(pending.y) || offsetX !== 0 || offsetY !== 0)
    ) {
      this.consumePendingActivationPosition();
    }

    this.cursorPosition = { x: nextX, y: nextY };
    this.emitCursorState();

    return {
      type: 'mouse',
      action: 'move',
      X: nextX,
      Y: nextY,
      offsetX: Math.round(offsetX),
      offsetY: Math.round(offsetY),
      isVisible: this.transportMode === 'absolute',
    };
  }

  private resetPendingMouseMove() {
    this.pendingMouseMove = null;
    this.pendingMovementX = 0;
    this.pendingMovementY = 0;
    if (this.mouseMoveRaf !== null) {
      cancelAnimationFrame(this.mouseMoveRaf);
      this.mouseMoveRaf = null;
    }
    if (this.mouseMoveTimer !== null) {
      window.clearTimeout(this.mouseMoveTimer);
      this.mouseMoveTimer = null;
    }
  }

  private flushPendingMouseMoveImmediately() {
    if (!this.pendingMouseMove) return;
    if (this.mouseMoveRaf !== null) {
      cancelAnimationFrame(this.mouseMoveRaf);
      this.mouseMoveRaf = null;
    }
    if (this.mouseMoveTimer !== null) {
      window.clearTimeout(this.mouseMoveTimer);
      this.mouseMoveTimer = null;
    }
    this.sendBatchedMouseMove();
  }

  // === Mouse buttons / wheel / context menu ===

  private handleMouseButton = (event: MouseEvent) => {
    const isPressed = event.type === 'mousedown';
    if (event.cancelable !== false) event.preventDefault();
    this.flushPendingMouseMoveImmediately();

    // In relative transport without pointer lock, mousedown re-requests the lock and the
    // button send is aborted (official CursorModeManager.maybeCaptureMouseDown).
    if (isPressed && this.shouldUsePointerLock() && !this.isPointerLocked() && this.requestPointerLock('mousedown')) {
      return;
    }

    if (this.cursorState === 1) return;
    this.sendRttEvent({ type: 'mouse', action: 'button', isPressed, btn: event.button });
  };

  private handleWheel = (event: WheelEvent) => {
    this.sendRttEvent({ type: 'mouse', action: 'wheel', deltaY: Math.sign(event.deltaY) });
  };

  private handleContextMenu = (event: MouseEvent) => {
    if (this.cursorState !== 1) event.preventDefault();
  };

  // === Keyboard (unchanged behavior aside from full-release hooks) ===

  private handleKeyDown = (event: KeyboardEvent) => {
    event.preventDefault();
    this.sendKeyboardButton(mapKeyCode(event), true);
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    event.preventDefault();
    this.sendKeyboardButton(mapKeyCode(event), false);
  };

  // === Focus / visibility / fullscreen ===

  private handleWindowFocus = () => {
    this.sendEvent({ type: 'stream', action: 'page', is_visible: true, is_focus: true });
  };

  private handleWindowBlur = () => {
    this.sendEvent({ type: 'stream', action: 'page', is_visible: true, is_focus: false });
    this.fullInputRelease('window blur');
  };

  private handleVisibilityChange = () => {
    this.sendEvent({ type: 'stream', action: 'page', is_visible: !document.hidden });
    if (document.hidden) this.releasePressedKeys('page hidden');
  };

  private handleFullscreenChange = () => {
    this.invalidateVideoSurfaceMetrics();
    if (!document.fullscreenElement) {
      this.fullInputRelease('fullscreen exited');
    }
  };

  private handlePreventCtrlWheelZoom = (event: WheelEvent) => {
    if (event.ctrlKey) event.preventDefault();
  };

  // === Pointer lock (official CursorModeManager.requestPointerLock, Legacy failure path) ===

  private isPointerLocked() {
    return document.pointerLockElement === this.videoElement;
  }

  private shouldUsePointerLock() {
    return this.cursorState !== 1 && this.transportMode === 'relative';
  }

  private exitPointerLockIfHeld() {
    this.isPointerLockRequestPending = false;
    if (!this.isPointerLocked()) return;
    try {
      document.exitPointerLock?.();
    } catch {
      // ignore
    }
  }

  private clearPointerLockRequestTimeouts() {
    this.pointerLockRequestTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    this.pointerLockRequestTimeoutIds.clear();
  }

  private schedulePointerLockRequestTimeout(callback: () => void, delay: number) {
    const timeoutId = window.setTimeout(() => {
      this.pointerLockRequestTimeoutIds.delete(timeoutId);
      callback();
    }, delay);
    this.pointerLockRequestTimeoutIds.add(timeoutId);
  }

  private getPointerLockOptions(): PointerLockOptions | null {
    if (detectPlatformCode() === 'lin') return null;
    return { unadjustedMovement: true };
  }

  private shouldFallbackToBasicPointerLock(error: unknown) {
    const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
    return (
      (error as { name?: string } | null)?.name === 'NotSupportedError' ||
      error instanceof RangeError ||
      message.includes('maximum call stack') ||
      message.includes('unadjustedmovement')
    );
  }

  private requestPointerLock(reason: string): boolean {
    if (!this.shouldUsePointerLock()) return false;

    const videoElement = this.videoElement;
    if (typeof videoElement.requestPointerLock !== 'function') return false;

    if (this.isPointerLocked()) {
      this.isPointerLockRequestPending = false;
      return true;
    }

    const timestamp = Date.now();
    if (this.isPointerLockRequestPending || timestamp - this.pointerLockRequestedAt < POINTER_LOCK_REQUEST_COOLDOWN_MS) {
      return false;
    }

    this.isPointerLockRequestPending = true;
    this.pointerLockRequestedAt = timestamp;

    const request = videoElement.requestPointerLock.bind(videoElement) as (options?: PointerLockOptions) => unknown;

    try {
      let pointerLockResult: unknown;
      const options = this.getPointerLockOptions();

      if (options) {
        try {
          pointerLockResult = request(options);
        } catch (optionError) {
          if (this.shouldFallbackToBasicPointerLock(optionError)) {
            this.log('Pointer lock options failed; using basic requestPointerLock');
            pointerLockResult = request();
          } else {
            throw optionError;
          }
        }
      } else {
        pointerLockResult = request();
      }

      if (!pointerLockResult) {
        this.schedulePointerLockRequestTimeout(() => {
          if (this.isPointerLockRequestPending && !this.isPointerLocked()) {
            this.handlePointerLockRequestFailure(new Error('Pointer lock was not acquired'), reason);
          }
        }, POINTER_LOCK_REQUEST_FALLBACK_TIMEOUT_MS);
      }

      if (isPromiseLike(pointerLockResult)) {
        this.settlePointerLockPromise(pointerLockResult, reason, options ? request : null);
      }
    } catch (error) {
      this.handlePointerLockRequestFailure(error, reason);
      return false;
    }

    return true;
  }

  private settlePointerLockPromise(promise: Promise<void>, reason: string, basicRetry: ((options?: PointerLockOptions) => unknown) | null) {
    promise
      .then(() => {
        this.isPointerLockRequestPending = false;
        if (!this.isPointerLocked()) {
          this.handlePointerLockRequestFailure(new Error('Pointer lock was not acquired'), reason);
        }
      })
      .catch((error: unknown) => {
        if (basicRetry && this.shouldFallbackToBasicPointerLock(error)) {
          this.log('Pointer lock with unadjustedMovement rejected; retrying basic requestPointerLock');
          try {
            const retryResult = basicRetry();
            if (isPromiseLike(retryResult)) {
              this.settlePointerLockPromise(retryResult, reason, null);
            } else {
              this.schedulePointerLockRequestTimeout(() => {
                if (this.isPointerLockRequestPending && !this.isPointerLocked()) {
                  this.handlePointerLockRequestFailure(new Error('Pointer lock was not acquired'), reason);
                }
              }, POINTER_LOCK_REQUEST_FALLBACK_TIMEOUT_MS);
            }
            return;
          } catch (retryError) {
            this.handlePointerLockRequestFailure(retryError, reason);
            return;
          }
        }
        this.handlePointerLockRequestFailure(error, reason);
      });
  }

  private handlePointerLockRequestFailure(error: unknown, reason: string) {
    this.isPointerLockRequestPending = false;
    this.clearPointerLockRequestTimeouts();
    this.log(`Pointer lock request failed (${reason}): ${error instanceof Error ? error.message : String(error)}`);
    this.fallBackToAbsoluteTransport();
  }

  // Legacy failure path: without a pointer lock the relative transport is unusable, so the
  // client falls back to absolute transport locally.
  private fallBackToAbsoluteTransport() {
    if (!this.setTransportMode('absolute')) return;
    if (this.cursorState !== 1) this.cursorState = 2;
    this.lastCursorState = this.getCursorStateForActiveCapture();
    this.resetPendingMouseMove();
    if (this.cursorState > 1) this.refreshSessionCursor();
    this.emitCursorState();
  }

  private handlePointerLockChange = () => {
    this.isPointerLockRequestPending = false;
    this.clearPointerLockRequestTimeouts();
    const isLocked = this.isPointerLocked();

    if (isLocked && !this.shouldUsePointerLock()) {
      this.exitPointerLockIfHeld();
    }

    if (!isLocked && this.transportMode === 'relative') {
      // Prior behavior: losing pointer lock in relative mode releases held keys.
      this.releasePressedKeys('pointer lock lost');
    }

    if (this.cursorState > 1) {
      this.refreshSessionCursor();
    }
  };

  private handlePointerLockError = () => {
    this.isPointerLockRequestPending = false;
    this.clearPointerLockRequestTimeouts();
    this.log('Pointer lock error; falling back to absolute transport');
    this.fallBackToAbsoluteTransport();
  };

  private async startWebRtcTransport() {
    if (this.pc) return;
    this.setStatus('Starting WebRTC');
    this.log('Starting WebRTC transport');

    this.peerId = crypto.randomUUID();
    const pc = new RTCPeerConnection({ iceServers: await this.fetchIceServers() });
    this.pc = pc;

    try {
      this.dataChannel = pc.createDataChannel('ClientDataChannel');
      this.dataChannel.onopen = () => this.log('Input data channel open');
      this.dataChannel.onclose = () => this.log('Input data channel closed');
    } catch {
      this.dataChannel = null;
    }

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      const hasVideo = stream.getVideoTracks().length > 0;
      const hasAudio = stream.getAudioTracks().length > 0;
      this.log(`Received remote stream tracks=${stream.getTracks().length} video=${hasVideo} audio=${hasAudio}`);

      if (hasVideo) {
        this.videoElement.autoplay = true;
        this.videoElement.playsInline = true;
        this.videoElement.srcObject = stream;
        this.invalidateVideoSurfaceMetrics();
        void this.videoElement.play().then(() => {
          this.log(`Video playback started readyState=${this.videoElement.readyState}`);
        }).catch((error: unknown) => {
          this.log(`Video play failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }

      if (hasAudio) {
        this.audioElement.autoplay = true;
        this.audioElement.srcObject = stream;
        void this.audioElement.play().catch((error: unknown) => {
          this.log(`Audio play failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) void this.sendLocalIceCandidate(event.candidate);
    };
    pc.onconnectionstatechange = () => {
      this.log(`WebRTC ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        this.setStatus('Streaming');
        this.sendEvent({ type: 'settings', action: 'ready' });
        this.sendEvent({ type: 'stream', action: 'page', is_visible: !document.hidden });
        this.startStatsLoop();
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.setStatus('Connection degraded');
      }
    };

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    this.log(`Created WebRTC offer length=${offer.sdp?.length ?? 0}`);
    offer.sdp = await this.prepareOfferSdp(offer.sdp ?? '');
    await pc.setLocalDescription(offer);
    const answer = await this.sendOffer(offer);
    this.log(`Received WebRTC answer length=${answer.sdp.length}`);
    await pc.setRemoteDescription(answer);
    this.startRemoteIcePolling();
  }

  private async prepareOfferSdp(sdp: string) {
    const gatewayCodec = await this.fetchGatewayCodec();
    const allowAv1 = gatewayCodec !== 'H264' && this.activeCodec === 'av1';
    const allowedCodecs = [
      ...(allowAv1 ? ['video/AV1'] : []),
      'video/H264',
      'video/rtx',
      'video/flexfec-03',
      'audio/red',
      'audio/opus',
    ];

    this.log(`Filtering SDP codecs=${allowedCodecs.join(',')} gatewayCodec=${gatewayCodec || 'unknown'}`);

    return filterAllowedCodecs(sdp, allowedCodecs)
      .replace('useinbandfec=1', 'useinbandfec=1;stereo=1;maxaveragebitrate=128000')
      .replace(/a=extmap:\d+ urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\n/g, '')
      .replace(/a=extmap:\d+ urn:ietf:params:rtp-hdrext:sdes:mid\r\n/g, '')
      .replace(/a=extmap:\d+ urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id\r\n/g, '')
      .replace(/a=extmap:\d+ urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id\r\n/g, '')
      .replace(/a=extmap:\d+ urn:ietf:params:rtp-hdrext:toffset\r\n/g, '')
      .replace(/a=extmap:\d+ urn:3gpp:video-orientation\r\n/g, '');
  }

  private async fetchGatewayCodec() {
    const url = `${this.webrtcApiBase}/api/getParams?sessionId=${encodeURIComponent(this.sessionId)}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return '';
      const payload = (await response.json()) as { codec?: unknown };
      const codec = typeof payload.codec === 'string' ? payload.codec : '';
      this.gatewayCodec = codec;
      return codec;
    } catch {
      return '';
    }
  }

  private sendGatewayStatus() {
    const maxFramerate = this.runtimeSettings.maxFramerate;
    const maxBitrate = this.runtimeSettings.maxBitrateMbps * 1_000_000;
    this.log('Sending stream status response');
    this.sendEvent({ type: 'keyboard', action: 'language', code: 1033 });
    this.sendEvent({
      type: 'stream',
      action: 'status',
      value: 'ok',
      params: {
        type: 'web',
        ver: 'openstroid',
        gpu: 'unknown',
        proto: 1,
        framerate_max: maxFramerate,
        bitrate_max: maxBitrate,
        hdr: this.runtimeSettings.hdrEnabled,
        cursor_zip: 'CompressionStream' in window,
        filler: this.runtimeSettings.fillerEnabled,
        beta: 0,
        rtcEngine: 'webrtc',
        rtcAudio: 'pcm',
        network_type: connectionType(),
        ...(this.activeCodec === 'av1' ? { codec: 'av1' } : {}),
      },
    });
    this.sendEvent({ type: 'stream', action: 'refreshRate', value: maxFramerate });
    if (this.runtimeSettings.fsrEnabled) {
      this.sendEvent({ type: 'stream', action: 'fsr', value: true });
    }
  }

  private async fetchIceServers() {
    const url = `${this.webrtcApiBase}/api/getIceServers?sessionId=${encodeURIComponent(this.sessionId)}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return DEFAULT_ICE_SERVERS;
      const payload = (await response.json()) as unknown;
      if (Array.isArray(payload)) return payload as RTCIceServer[];
      if (payload && typeof payload === 'object') {
        const record = payload as { iceServers?: RTCIceServer[]; data?: RTCIceServer[] | { iceServers?: RTCIceServer[] } };
        if (Array.isArray(record.iceServers)) return record.iceServers;
        if (Array.isArray(record.data)) return record.data;
        if (record.data && !Array.isArray(record.data) && Array.isArray(record.data.iceServers)) return record.data.iceServers;
      }
    } catch {
      return DEFAULT_ICE_SERVERS;
    }
    return DEFAULT_ICE_SERVERS;
  }

  private async sendOffer(offer: RTCSessionDescriptionInit) {
    const url = `${this.webrtcApiBase}/api/call?peerid=${encodeURIComponent(this.peerId)}&sessionId=${encodeURIComponent(this.sessionId)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(offer),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`WebRTC offer rejected (${response.status}): ${text.slice(0, 240)}`);
    }
    const payload = (await response.json()) as { data?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; type?: RTCSdpType; sdp?: string };
    const answer = payload.data ?? payload.answer ?? payload;
    if (!answer.type || !answer.sdp) throw new Error('Invalid WebRTC answer from Boosteroid gateway.');
    return { type: answer.type, sdp: answer.sdp };
  }

  private async sendLocalIceCandidate(candidate: RTCIceCandidate) {
    const url = `${this.webrtcApiBase}/api/addIceCandidate?peerid=${encodeURIComponent(this.peerId)}&sessionId=${encodeURIComponent(this.sessionId)}`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candidate.toJSON()),
    }).catch(() => undefined);
  }

  private startRemoteIcePolling() {
    this.stopRemoteIcePolling();
    this.remoteIceTimer = window.setInterval(() => {
      void this.fetchRemoteIceCandidates();
    }, 500);
  }

  private stopRemoteIcePolling() {
    if (this.remoteIceTimer !== null) window.clearInterval(this.remoteIceTimer);
    this.remoteIceTimer = null;
  }

  private async fetchRemoteIceCandidates() {
    if (!this.pc) return;
    const url = `${this.webrtcApiBase}/api/getIceCandidate?peerid=${encodeURIComponent(this.peerId)}&sessionId=${encodeURIComponent(this.sessionId)}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const payload = (await response.json()) as unknown;
      const candidates = this.extractIceCandidates(payload);
      for (const candidate of candidates) {
        const key = JSON.stringify(candidate);
        if (this.remoteIceDedup.has(key)) continue;
        this.remoteIceDedup.add(key);
        await this.pc.addIceCandidate(candidate).catch(() => undefined);
      }
    } catch {
      return;
    }
  }

  private extractIceCandidates(payload: unknown): RTCIceCandidateInit[] {
    if (Array.isArray(payload)) return payload as RTCIceCandidateInit[];
    if (!payload || typeof payload !== 'object') return [];
    const record = payload as { data?: unknown; candidate?: RTCIceCandidateInit };
    if (Array.isArray(record.data)) return record.data as RTCIceCandidateInit[];
    if (record.candidate) return [record.candidate];
    return [];
  }

  private sendKeyboardButton(code: number, isPressed: boolean) {
    if (!code) return;
    if (isPressed) {
      if (this.pressedKeys.has(code)) return;
      this.pressedKeys.add(code);
    } else {
      this.pressedKeys.delete(code);
    }

    this.sendRttEvent({ type: 'keyboard', action: 'button', isPressed, code });
  }

  private releasePressedKeys(reason: string) {
    if (!this.pressedKeys.size) return;
    const keys = Array.from(this.pressedKeys);
    this.pressedKeys.clear();
    for (const code of keys) {
      this.sendRttEvent({ type: 'keyboard', action: 'button', isPressed: false, code, time: Date.now() });
    }
    this.log(`Released ${keys.length} pressed key(s): ${reason}`);
  }

  private startStatsLoop() {
    this.stopStatsLoop();
    this.statsTimer = window.setInterval(() => {
      void this.sendStats();
    }, 1000);
  }

  private stopStatsLoop() {
    if (this.statsTimer !== null) window.clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.statsPrev = null;
  }

  private async sendStats() {
    if (!this.pc) return;
    const stats = await this.pc.getStats().catch(() => null);
    if (!stats) return;
    for (const report of stats.values()) {
      if (report.type !== 'inbound-rtp' || report.kind !== 'video') continue;
      const bytesReceived = Number(report.bytesReceived ?? 0);
      const framesDecoded = Number(report.framesDecoded ?? 0);
      const framesReceived = Number(report.framesReceived ?? 0);
      const packetsReceived = Number(report.packetsReceived ?? 0);
      const packetsLost = Number(report.packetsLost ?? 0);
      if (!this.statsPrev) {
        this.statsPrev = { timestamp: report.timestamp, bytesReceived, framesDecoded, framesReceived, packetsReceived, packetsLost };
        return;
      }
      const elapsedSec = Math.max(0.001, (report.timestamp - this.statsPrev.timestamp) / 1000);
      const packetDiff = packetsReceived - this.statsPrev.packetsReceived;
      const realBitrate = Math.max(0, Math.round(((bytesReceived - this.statsPrev.bytesReceived) * 8) / elapsedSec));
      const decodedFps = Math.max(0, Math.round((framesDecoded - this.statsPrev.framesDecoded) / elapsedSec));
      const receivedFps = Math.max(0, Math.round((framesReceived - this.statsPrev.framesReceived) / elapsedSec));
      const packetLoss = packetDiff > 0 ? Number((((packetsLost - this.statsPrev.packetsLost) * 100) / packetDiff).toFixed(2)) : 0;
      this.sendEvent({
        type: 'stream',
        action: 'bitrate',
        realBitrate,
        framerateDecoded: decodedFps,
        framerateReceived: receivedFps,
        lossPacket: packetLoss,
        time: Date.now(),
      });
      this.onStats({
        bitrate: realBitrate,
        decodedFps,
        receivedFps,
        packetLoss,
        connectionState: this.pc?.connectionState ?? 'unknown',
        gatewayHost: this.gatewayHost,
        codec: this.gatewayCodec || this.activeCodec,
        at: Date.now(),
      });
      this.statsPrev = { timestamp: report.timestamp, bytesReceived, framesDecoded, framesReceived, packetsReceived, packetsLost };
      return;
    }
  }

  private sendEvent(data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // Every 30th input event carries a timestamp for RTT measurement (official sendRttEvent).
  private sendRttEvent(data: Record<string, unknown>) {
    this.eventCount += 1;
    if (this.eventCount > 29) {
      data.time = Date.now();
      this.eventCount = 0;
    }
    this.sendInputEvent(data);
  }

  private sendInputEvent(data: Record<string, unknown>) {
    const type = typeof data.type === 'string' ? data.type : '';
    const isExternalDevice = type === 'keyboard' || type === 'mouse' || type === 'controller' || type === 'finger';
    const payload = isExternalDevice
      ? { ...data, id_cmd: this.idCmdCounter++, from_udp: false }
      : { ...data };

    this.sendEvent(payload);

    if (isExternalDevice && this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify({ ...payload, from_udp: true }));
    }
  }

  private log(message: string) {
    this.onLog(`[${now()}] ${message}`);
  }

  private setStatus(status: StreamStatus) {
    this.onStatus(status);
  }
}
