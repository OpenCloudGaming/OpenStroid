import type { StreamClientConfig } from '../types';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

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
type InputHandlerName =
  | 'click'
  | 'contextmenu'
  | 'mousemove'
  | 'mousedown'
  | 'mouseup'
  | 'wheel'
  | 'keydown'
  | 'keyup'
  | 'blur'
  | 'visibilitychange'
  | 'pointerlockchange'
  | 'pointerlockerror';

interface StreamClientOptions {
  videoElement: HTMLVideoElement;
  audioElement?: HTMLAudioElement;
  onLog?: LogHandler;
  onStatus?: StatusHandler;
  onCursor?: CursorHandler;
  onMouseMode?: MouseModeHandler;
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

function numberFromMessage(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boolFromMessage(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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

async function cursorResourceToImageUrl(resource: unknown, zipped: unknown) {
  if (typeof resource !== 'string' || !resource.trim()) return null;
  const trimmed = resource.trim();

  if (trimmed.startsWith('data:image/')) return trimmed;

  if (zipped === true) {
    const inflated = await inflateCursorResource(trimmed);
    if (!inflated) return null;
    const asText = new TextDecoder().decode(inflated);
    if (asText.trim().startsWith('<svg')) {
      return `data:image/svg+xml;base64,${btoa(asText)}`;
    }
    return URL.createObjectURL(new Blob([inflated], { type: 'image/x-icon' }));
  }

  if (trimmed.startsWith('<svg')) return `data:image/svg+xml;base64,${btoa(trimmed)}`;
  return `data:image/x-icon;base64,${trimmed}`;
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
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private sessionId = '';
  private sessionQuery = '';
  private gatewayHost = '';
  private webrtcApiBase = '';
  private peerId = '';
  private preferredCodec = 'auto';
  private gateways: unknown[] = [];
  private remoteIceTimer: number | null = null;
  private statsTimer: number | null = null;
  private remoteIceDedup = new Set<string>();
  private cursorImages = new Map<string, string | null>();
  private cursor: StreamCursorState = { x: 0.5, y: 0.5, visible: false, imageUrl: null };
  private mouseMode: StreamMouseMode = 'absolute';
  private pressedKeys = new Set<number>();
  private inputInstalled = false;
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
  private handlers: Partial<Record<InputHandlerName, EventListener>> = {};

  constructor(options: StreamClientOptions) {
    this.videoElement = options.videoElement;
    this.audioElement = options.audioElement ?? new Audio();
    this.onLog = options.onLog ?? (() => undefined);
    this.onStatus = options.onStatus ?? (() => undefined);
    this.onCursor = options.onCursor ?? (() => undefined);
    this.onMouseMode = options.onMouseMode ?? (() => undefined);
  }

  async setMouseMode(mode: StreamMouseMode) {
    this.mouseMode = mode;
    this.onMouseMode(mode);
    this.videoElement.focus();

    if (mode === 'relative') {
      await this.requestPointerLock();
      this.cursor = { ...this.cursor, visible: false };
      this.onCursor(this.cursor);
      return;
    }

    if (document.pointerLockElement === this.videoElement) {
      document.exitPointerLock?.();
    }
    this.cursor = { ...this.cursor, visible: true };
    this.onCursor(this.cursor);
  }

  async toggleMouseMode() {
    await this.setMouseMode(this.mouseMode === 'relative' ? 'absolute' : 'relative');
  }

  async connect(config: StreamClientConfig) {
    await this.disconnect(true);
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
    this.preferredCodec = config.preferredCodec ?? 'auto';
    this.gateways = config.gateways ?? [];

    this.setStatus('Preparing');
    this.log(`Session ${this.sessionId}`);
    this.gatewayHost = normalizeGatewayHost(await this.resolveGateway(config.homeUrl));
    this.webrtcApiBase = `https://${normalizeWebRtcApiHost(this.gatewayHost)}/webrtc`;
    this.log(`Resolved gateway ${this.gatewayHost}; queryLength=${this.sessionQuery.length}`);

    await this.openControlWebSocket();
    this.installInputHandlers();
  }

  async disconnect(silent = false) {
    this.releasePressedKeys('disconnect');
    if (document.pointerLockElement === this.videoElement) {
      document.exitPointerLock?.();
    }
    this.uninstallInputHandlers();
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
    this.mouseMode = 'absolute';
    this.onMouseMode(this.mouseMode);
    this.cursor = { x: 0.5, y: 0.5, visible: false, imageUrl: null };
    this.onCursor(this.cursor);
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
    if (this.preferredCodec === 'av1' || this.preferredCodec === 'h264') return this.preferredCodec;
    return 'h264';
  }

  private async openControlWebSocket() {
    const codec = await this.selectedCodec();
    const width = Math.max(1280, Math.round(window.innerWidth * window.devicePixelRatio));
    const height = Math.max(720, Math.round(window.innerHeight * window.devicePixelRatio));
    const params = new URLSearchParams({
      x: String(width),
      y: String(height),
      lang: 'en',
      refreshRate: '60',
      rtcEngine: 'webrtc',
      clientType: 'web',
      devType: 'desktop',
      os: detectPlatformCode(),
      rtcAudio: 'pcm',
    });
    if (codec === 'av1') params.set('codec', 'av1');
    const wsUrl = `wss://${this.gatewayHost}/?${this.sessionQuery}&${params.toString()}`;

    this.setStatus('Opening control socket');
    this.log(`Opening control socket on ${this.gatewayHost}; codec=${codec}`);
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

    if (message.type === 'cursor') {
      await this.handleRemoteCursor(message);
      return;
    }

    if (message.type === 'mouse') {
      this.handleRemoteMouse(message);
      return;
    }

    if (message.type === 'settings' && message.action === 'streamIds') {
      this.log('Received legacy Janus streamIds message; WebRTC path is active for this build.');
      return;
    }

    this.log(`Control: ${JSON.stringify(message).slice(0, 300)}`);
  }

  private async handleRemoteCursor(message: Record<string, unknown>) {
    const name = typeof message.name === 'string' ? message.name : this.cursor.name;
    let imageUrl = name ? this.cursorImages.get(name) : this.cursor.imageUrl;

    if (name && message.resource) {
      imageUrl = await cursorResourceToImageUrl(message.resource, message.zipped);
      this.cursorImages.set(name, imageUrl);
    }

    const x = numberFromMessage(message.X) ?? this.cursor.x;
    const y = numberFromMessage(message.Y) ?? this.cursor.y;
    this.cursor = {
      x,
      y,
      visible: this.mouseMode === 'relative' ? false : boolFromMessage(message.isVisible, this.cursor.visible),
      imageUrl: imageUrl ?? null,
      offsetX: numberFromMessage(message.offsetX) ?? this.cursor.offsetX ?? 0,
      offsetY: numberFromMessage(message.offsetY) ?? this.cursor.offsetY ?? 0,
      name,
    };
    this.onCursor(this.cursor);
  }

  private handleRemoteMouse(message: Record<string, unknown>) {
    const x = numberFromMessage(message.X);
    const y = numberFromMessage(message.Y);
    const offsetX = numberFromMessage(message.offsetX);
    const offsetY = numberFromMessage(message.offsetY);
    const isPointerLocked = this.isRelativePointerLocked();
    const isRemoteVisible = boolFromMessage(message.isVisible, this.cursor.visible);
    const rect = this.getVideoContentRect();
    const nextX =
      x ??
      (isPointerLocked && offsetX !== null ? clamp01(this.cursor.x + offsetX / Math.max(rect.width, 1)) : this.cursor.x);
    const nextY =
      y ??
      (isPointerLocked && offsetY !== null ? clamp01(this.cursor.y + offsetY / Math.max(rect.height, 1)) : this.cursor.y);

    this.cursor = {
      ...this.cursor,
      x: nextX,
      y: nextY,
      visible: this.mouseMode === 'relative' ? false : isRemoteVisible,
      offsetX: offsetX ?? this.cursor.offsetX ?? 0,
      offsetY: offsetY ?? this.cursor.offsetY ?? 0,
    };
    this.onCursor(this.cursor);
  }

  private getVideoContentRect() {
    const rect = this.videoElement.getBoundingClientRect();
    const videoWidth = this.videoElement.videoWidth || 16;
    const videoHeight = this.videoElement.videoHeight || 9;
    const frameRatio = rect.width / Math.max(rect.height, 1);
    const videoRatio = videoWidth / Math.max(videoHeight, 1);

    if (videoRatio > frameRatio) {
      const height = rect.width / videoRatio;
      return {
        left: rect.left,
        top: rect.top + (rect.height - height) / 2,
        width: rect.width,
        height,
      };
    }

    const width = rect.height * videoRatio;
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top,
      width,
      height: rect.height,
    };
  }

  private updateCursorFromMouseEvent(mouseEvent: MouseEvent) {
    const rect = this.getVideoContentRect();
    const isPointerLocked = this.isRelativePointerLocked();
    this.cursor = {
      ...this.cursor,
      x: isPointerLocked
        ? clamp01(this.cursor.x + (mouseEvent.movementX || 0) / Math.max(rect.width, 1))
        : clamp01((mouseEvent.clientX - rect.left) / Math.max(rect.width, 1)),
      y: isPointerLocked
        ? clamp01(this.cursor.y + (mouseEvent.movementY || 0) / Math.max(rect.height, 1))
        : clamp01((mouseEvent.clientY - rect.top) / Math.max(rect.height, 1)),
      visible: this.mouseMode !== 'relative',
      offsetX: mouseEvent.movementX || 0,
      offsetY: mouseEvent.movementY || 0,
    };
    this.onCursor(this.cursor);
    return isPointerLocked;
  }

  private isRelativePointerLocked() {
    return this.mouseMode === 'relative' && document.pointerLockElement === this.videoElement;
  }

  private async requestPointerLock() {
    const requestPointerLock = this.videoElement.requestPointerLock?.bind(this.videoElement);
    if (!requestPointerLock) return;

    try {
      const result = requestPointerLock({ unadjustedMovement: true } as PointerLockOptions);
      if (result instanceof Promise) await result;
    } catch {
      try {
        const result = requestPointerLock();
        if (result instanceof Promise) await result;
      } catch (error) {
        this.mouseMode = 'absolute';
        this.onMouseMode(this.mouseMode);
        this.log(`Pointer lock request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

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
    const allowAv1 = gatewayCodec !== 'H264' && this.preferredCodec === 'av1';
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
      return typeof payload.codec === 'string' ? payload.codec : '';
    } catch {
      return '';
    }
  }

  private sendGatewayStatus() {
    const maxFramerate = 60;
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
        bitrate_max: 20_000_000,
        hdr: false,
        cursor_zip: 'CompressionStream' in window,
        filler: false,
        beta: 0,
        rtcEngine: 'webrtc',
        rtcAudio: 'pcm',
        network_type: connectionType(),
      },
    });
    this.sendEvent({ type: 'stream', action: 'refreshRate', value: maxFramerate });
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

  private installInputHandlers() {
    if (this.inputInstalled) return;
    const target = this.videoElement;
    target.tabIndex = 0;

    this.handlers.click = (event) => {
      this.updateCursorFromMouseEvent(event as MouseEvent);
      target.focus();
    };
    this.handlers.contextmenu = (event) => {
      event.preventDefault();
    };
    this.handlers.mousemove = (event) => {
      const mouseEvent = event as MouseEvent;
      const isRelative = this.updateCursorFromMouseEvent(mouseEvent);
      this.sendRttEvent({
        type: 'mouse',
        action: 'move',
        X: Number(this.cursor.x.toFixed(4)),
        Y: Number(this.cursor.y.toFixed(4)),
        isVisible: !isRelative,
        offsetX: isRelative ? mouseEvent.movementX || 0 : 0,
        offsetY: isRelative ? mouseEvent.movementY || 0 : 0,
      });
    };
    this.handlers.mousedown = (event) => {
      event.preventDefault();
      const isRelative = this.updateCursorFromMouseEvent(event as MouseEvent);
      this.sendRttEvent({
        type: 'mouse',
        action: 'button',
        isPressed: true,
        btn: (event as MouseEvent).button,
        X: Number(this.cursor.x.toFixed(4)),
        Y: Number(this.cursor.y.toFixed(4)),
        isVisible: !isRelative,
      });
    };
    this.handlers.mouseup = (event) => {
      event.preventDefault();
      const isRelative = this.updateCursorFromMouseEvent(event as MouseEvent);
      this.sendRttEvent({
        type: 'mouse',
        action: 'button',
        isPressed: false,
        btn: (event as MouseEvent).button,
        X: Number(this.cursor.x.toFixed(4)),
        Y: Number(this.cursor.y.toFixed(4)),
        isVisible: !isRelative,
      });
    };
    this.handlers.wheel = (event) => {
      event.preventDefault();
      this.sendRttEvent({ type: 'mouse', action: 'wheel', deltaY: Math.sign((event as WheelEvent).deltaY || 0) });
    };
    this.handlers.keydown = (event) => {
      event.preventDefault();
      this.sendKeyboardButton(mapKeyCode(event as KeyboardEvent), true);
    };
    this.handlers.keyup = (event) => {
      event.preventDefault();
      this.sendKeyboardButton(mapKeyCode(event as KeyboardEvent), false);
    };
    this.handlers.blur = () => {
      this.releasePressedKeys('window blur');
    };
    this.handlers.visibilitychange = () => {
      this.sendEvent({ type: 'stream', action: 'page', is_visible: !document.hidden });
      if (document.hidden) this.releasePressedKeys('page hidden');
    };
    this.handlers.pointerlockchange = () => {
      const isLocked = document.pointerLockElement === target;
      if (isLocked) {
        this.mouseMode = 'relative';
        this.onMouseMode(this.mouseMode);
        this.cursor = { ...this.cursor, visible: false };
        this.onCursor(this.cursor);
        return;
      }

      if (this.mouseMode === 'relative') {
        this.mouseMode = 'absolute';
        this.onMouseMode(this.mouseMode);
      }
      this.releasePressedKeys('pointer lock changed');
      this.cursor = { ...this.cursor, visible: true };
      this.onCursor(this.cursor);
    };
    this.handlers.pointerlockerror = () => {
      this.mouseMode = 'absolute';
      this.onMouseMode(this.mouseMode);
      this.log('Pointer lock failed; staying in absolute mouse mode');
    };

    target.addEventListener('click', this.handlers.click);
    target.addEventListener('contextmenu', this.handlers.contextmenu);
    target.addEventListener('mousemove', this.handlers.mousemove);
    target.addEventListener('mousedown', this.handlers.mousedown);
    target.addEventListener('mouseup', this.handlers.mouseup);
    target.addEventListener('wheel', this.handlers.wheel, { passive: false });
    window.addEventListener('keydown', this.handlers.keydown);
    window.addEventListener('keyup', this.handlers.keyup);
    window.addEventListener('blur', this.handlers.blur);
    document.addEventListener('visibilitychange', this.handlers.visibilitychange);
    document.addEventListener('pointerlockchange', this.handlers.pointerlockchange);
    document.addEventListener('pointerlockerror', this.handlers.pointerlockerror);
    this.inputInstalled = true;
    this.sendRttEvent({ type: 'mouse', action: 'connected' });
    this.sendRttEvent({ type: 'keyboard', action: 'connected' });
  }

  private uninstallInputHandlers() {
    if (!this.inputInstalled) return;
    this.releasePressedKeys('input handlers removed');
    const target = this.videoElement;
    if (this.handlers.click) target.removeEventListener('click', this.handlers.click);
    if (this.handlers.contextmenu) target.removeEventListener('contextmenu', this.handlers.contextmenu);
    if (this.handlers.mousemove) target.removeEventListener('mousemove', this.handlers.mousemove);
    if (this.handlers.mousedown) target.removeEventListener('mousedown', this.handlers.mousedown);
    if (this.handlers.mouseup) target.removeEventListener('mouseup', this.handlers.mouseup);
    if (this.handlers.wheel) target.removeEventListener('wheel', this.handlers.wheel);
    if (this.handlers.keydown) window.removeEventListener('keydown', this.handlers.keydown);
    if (this.handlers.keyup) window.removeEventListener('keyup', this.handlers.keyup);
    if (this.handlers.blur) window.removeEventListener('blur', this.handlers.blur);
    if (this.handlers.visibilitychange) document.removeEventListener('visibilitychange', this.handlers.visibilitychange);
    if (this.handlers.pointerlockchange) document.removeEventListener('pointerlockchange', this.handlers.pointerlockchange);
    if (this.handlers.pointerlockerror) document.removeEventListener('pointerlockerror', this.handlers.pointerlockerror);
    this.handlers = {};
    this.inputInstalled = false;
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
      this.sendEvent({
        type: 'stream',
        action: 'bitrate',
        realBitrate: Math.max(0, Math.round(((bytesReceived - this.statsPrev.bytesReceived) * 8) / elapsedSec)),
        framerateDecoded: Math.max(0, Math.round((framesDecoded - this.statsPrev.framesDecoded) / elapsedSec)),
        framerateReceived: Math.max(0, Math.round((framesReceived - this.statsPrev.framesReceived) / elapsedSec)),
        lossPacket: packetDiff > 0 ? Number((((packetsLost - this.statsPrev.packetsLost) * 100) / packetDiff).toFixed(2)) : 0,
        time: Date.now(),
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

  private sendRttEvent(data: Record<string, unknown>) {
    this.eventCount += 1;
    if (this.eventCount >= 20) {
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
