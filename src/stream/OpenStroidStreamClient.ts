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

interface StreamClientOptions {
  videoElement: HTMLVideoElement;
  onLog?: LogHandler;
  onStatus?: StatusHandler;
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

export class OpenStroidStreamClient {
  private readonly videoElement: HTMLVideoElement;
  private readonly onLog: LogHandler;
  private readonly onStatus: StatusHandler;
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
  private inputInstalled = false;
  private eventCount = 0;
  private statsPrev: {
    timestamp: number;
    bytesReceived: number;
    framesDecoded: number;
    framesReceived: number;
    packetsReceived: number;
    packetsLost: number;
  } | null = null;
  private handlers: Partial<Record<'click' | 'mousemove' | 'mousedown' | 'mouseup' | 'wheel' | 'keydown' | 'keyup', EventListener>> = {};

  constructor(options: StreamClientOptions) {
    this.videoElement = options.videoElement;
    this.onLog = options.onLog ?? (() => undefined);
    this.onStatus = options.onStatus ?? (() => undefined);
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
    this.webrtcApiBase = `https://${this.gatewayHost}/webrtc`;
    this.log(`Resolved gateway ${this.gatewayHost}; queryLength=${this.sessionQuery.length}`);

    await this.openControlWebSocket();
    this.installInputHandlers();
  }

  async disconnect(silent = false) {
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
    try {
      const result = await navigator.mediaCapabilities?.decodingInfo({
        type: 'media-source',
        video: {
          contentType: 'video/webm; codecs=av01.0.08M.08',
          width: Math.max(1280, window.innerWidth),
          height: Math.max(720, window.innerHeight),
          bitrate: 10000000,
          framerate: 60,
        },
      });
      return result?.supported ? 'av1' : 'h264';
    } catch {
      return 'h264';
    }
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
      codec,
    });
    const wsUrl = `wss://${this.gatewayHost}/?${this.sessionQuery}&${params.toString()}`;

    this.setStatus('Opening control socket');
    this.log(`Opening control socket on ${this.gatewayHost}`);
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
      this.sendEvent({
        type: 'stream',
        action: 'status',
        value: { page: document.visibilityState, network_type: connectionType() },
      });
      return;
    }

    if (message.type === 'settings' && message.action === 'streamIds') {
      this.log('Received legacy Janus streamIds message; WebRTC path is active for this build.');
      return;
    }

    this.log(`Control: ${JSON.stringify(message).slice(0, 300)}`);
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
    } catch {
      this.dataChannel = null;
    }

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        this.log(`Received remote stream tracks=${stream.getTracks().length}`);
        this.videoElement.srcObject = stream;
        void this.videoElement.play().catch(() => undefined);
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
        this.startStatsLoop();
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.setStatus('Connection degraded');
      }
    };

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    const offer = await pc.createOffer();
    this.log(`Created WebRTC offer length=${offer.sdp?.length ?? 0}`);
    offer.sdp = this.prepareOfferSdp(offer.sdp ?? '');
    await pc.setLocalDescription(offer);
    const answer = await this.sendOffer(offer);
    this.log(`Received WebRTC answer length=${answer.sdp.length}`);
    await pc.setRemoteDescription(answer);
    this.startRemoteIcePolling();
  }

  private prepareOfferSdp(sdp: string) {
    return sdp
      .replace('useinbandfec=1', 'useinbandfec=1;stereo=1;maxaveragebitrate=128000')
      .replace(/a=extmap:\d+ urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\n/g, '')
      .replace(/a=extmap:\d+ urn:ietf:params:rtp-hdrext:sdes:mid\r\n/g, '')
      .replace(/a=extmap:\d+ urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id\r\n/g, '')
      .replace(/a=extmap:\d+ urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id\r\n/g, '')
      .replace(/a=extmap:\d+ urn:ietf:params:rtp-hdrext:toffset\r\n/g, '');
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

    this.handlers.click = () => {
      target.focus();
      void target.requestPointerLock?.();
    };
    this.handlers.mousemove = (event) => {
      const mouseEvent = event as MouseEvent;
      const rect = target.getBoundingClientRect();
      this.sendRttEvent({
        type: 'mouse',
        action: 'move',
        X: Number(Math.min(Math.max((mouseEvent.clientX - rect.left) / rect.width, 0), 1).toFixed(4)),
        Y: Number(Math.min(Math.max((mouseEvent.clientY - rect.top) / rect.height, 0), 1).toFixed(4)),
        isVisible: document.pointerLockElement !== target,
        offsetX: mouseEvent.movementX || 0,
        offsetY: mouseEvent.movementY || 0,
      });
    };
    this.handlers.mousedown = (event) => {
      event.preventDefault();
      this.sendRttEvent({ type: 'mouse', action: 'button', isPressed: true, btn: (event as MouseEvent).button });
    };
    this.handlers.mouseup = (event) => {
      event.preventDefault();
      this.sendRttEvent({ type: 'mouse', action: 'button', isPressed: false, btn: (event as MouseEvent).button });
    };
    this.handlers.wheel = (event) => {
      event.preventDefault();
      this.sendRttEvent({ type: 'mouse', action: 'wheel', deltaY: Math.sign((event as WheelEvent).deltaY || 0) });
    };
    this.handlers.keydown = (event) => {
      event.preventDefault();
      this.sendRttEvent({ type: 'keyboard', action: 'button', isPressed: true, code: mapKeyCode(event as KeyboardEvent) });
    };
    this.handlers.keyup = (event) => {
      event.preventDefault();
      this.sendRttEvent({ type: 'keyboard', action: 'button', isPressed: false, code: mapKeyCode(event as KeyboardEvent) });
    };

    target.addEventListener('click', this.handlers.click);
    target.addEventListener('mousemove', this.handlers.mousemove);
    target.addEventListener('mousedown', this.handlers.mousedown);
    target.addEventListener('mouseup', this.handlers.mouseup);
    target.addEventListener('wheel', this.handlers.wheel, { passive: false });
    window.addEventListener('keydown', this.handlers.keydown);
    window.addEventListener('keyup', this.handlers.keyup);
    this.inputInstalled = true;
    this.sendEvent({ type: 'mouse', action: 'connected' });
    this.sendEvent({ type: 'keyboard', action: 'connected' });
  }

  private uninstallInputHandlers() {
    if (!this.inputInstalled) return;
    const target = this.videoElement;
    if (this.handlers.click) target.removeEventListener('click', this.handlers.click);
    if (this.handlers.mousemove) target.removeEventListener('mousemove', this.handlers.mousemove);
    if (this.handlers.mousedown) target.removeEventListener('mousedown', this.handlers.mousedown);
    if (this.handlers.mouseup) target.removeEventListener('mouseup', this.handlers.mouseup);
    if (this.handlers.wheel) target.removeEventListener('wheel', this.handlers.wheel);
    if (this.handlers.keydown) window.removeEventListener('keydown', this.handlers.keydown);
    if (this.handlers.keyup) window.removeEventListener('keyup', this.handlers.keyup);
    this.handlers = {};
    this.inputInstalled = false;
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
    this.sendEvent(data);
  }

  private log(message: string) {
    this.onLog(`[${now()}] ${message}`);
  }

  private setStatus(status: StreamStatus) {
    this.onStatus(status);
  }
}
