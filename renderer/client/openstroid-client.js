import { decodeJwt } from "./jwt.js";

const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" }
];

function now() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function normalizeBaseUrl(homeUrl) {
  return homeUrl.trim().replace(/\/+$/, "");
}

function normalizeQuery(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Stream Query is required");
  }
  return trimmed.startsWith("?") ? trimmed : `?${trimmed}`;
}

function normalizeGatewayHost(gatewayUrl) {
  const withoutProtocol = gatewayUrl.replace(/^https?:\/\//i, "");
  const host = withoutProtocol.split("/")[0];
  return host.trim();
}

function normalizeSessionQueryString(token) {
  return token.startsWith("?") ? token.slice(1) : token;
}

function detectPlatformCode() {
  const source = [
    navigator.userAgent || "",
    navigator.platform || "",
    navigator.userAgentData?.platform || ""
  ]
    .join(" ")
    .toLowerCase();

  const rules = [
    [/\b(tizen|tizen\s*tv)\b/, "tizen"],
    [/\b(webos|web0s)\b/, "webos"],
    [/\b(vidaa|hisense\s*tv)\b/, "vidaa"],
    [/\b(titan\s*os|titanos)\b/, "titan"],
    [/\b(apple\s*tv|appletv|tvos)\b/, "atv"],
    [/\b(fire\s*os|fire\s*tv)\b/, "fireos"],
    [/\bandroid\s*tv\b/, "atv"],
    [/\bandroid\b/, "a"],
    [/\b(windows|win32|win64)\b/, "win"],
    [/\b(macintosh|mac os x|macos)\b/, "mac"],
    [/\b(linux|x11)\b/, "lin"]
  ];

  for (const [pattern, value] of rules) {
    if (pattern.test(source)) {
      return value;
    }
  }
  return "win";
}

function getRefreshRate() {
  return Math.round(screen?.orientation?.type?.includes("landscape") ? 60 : 60);
}

function mapKeyCode(event) {
  let code = event.keyCode || event.which || 0;
  if (code === 16) {
    code = event.location === 1 ? 0xa0 : 0xa1;
  } else if (code === 17) {
    code = event.location === 1 ? 0xa2 : 0xa3;
  } else if (code === 18) {
    code = event.location === 1 ? 0xa4 : 0xa5;
  }
  return code;
}

function safeParseJson(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function pickGatewayAddress(detailsData) {
  if (detailsData?.gw) return detailsData.gw;
  if (detailsData?.gateway) return detailsData.gateway;
  if (detailsData?.data?.gw) return detailsData.data.gw;
  if (Array.isArray(detailsData?.gateways) && detailsData.gateways.length > 0) {
    const first = detailsData.gateways[0];
    return typeof first === "string" ? first : first.address;
  }
  return null;
}

/**
 * Select best gateway from list based on RTT or just pick first
 */
async function selectBestGateway(gateways) {
  if (!Array.isArray(gateways) || gateways.length === 0) {
    return null;
  }
  
  if (gateways.length === 1) {
    const g = gateways[0];
    return typeof g === "string" ? g : g.address;
  }
  
  // For now, return first gateway. In production, could ping test each one
  const g = gateways[0];
  return typeof g === "string" ? g : g.address;
}

export class OpenStroidClient {
  constructor({ videoElement, onLog, onStatus, onSessionMeta }) {
    this.videoElement = videoElement;
    this.onLog = onLog || (() => undefined);
    this.onStatus = onStatus || (() => undefined);
    this.onSessionMeta = onSessionMeta || (() => undefined);

    this.ws = null;
    this.pc = null;
    this.sessionId = "";
    this.gatewayHost = "";
    this.homeUrl = "";
    this.streamingGatewayQueryString = "";
    this.language = "en";
    this.preferredCodec = "auto";
    this.accessToken = "";
    this.effectiveAccessToken = "";
    this.authDataToken = "";
    this.sessionQuery = "";
    this.sessionQueryCandidates = [];
    this.webrtcApiBase = "";
    this.peerId = "";
    this.remoteIceInterval = null;
    this.statsInterval = null;
    this.remoteIceDedup = new Set();
    this.inputInstalled = false;
    this.eventCount = 0;
    this.statsPrev = null;
    this.providedGateways = null;

    this.handlers = {};
  }

  log(message) {
    this.onLog(`[${now()}] ${message}`);
  }

  setStatus(status) {
    this.onStatus(status);
  }

  get sessionMeta() {
    return {
      sessionId: this.sessionId || "-",
      gatewayHost: this.gatewayHost || "-"
    };
  }

  authHeaders() {
    const authToken = this.effectiveAccessToken || this.accessToken;
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authToken,
      "Authorization-Data": this.authDataToken
    };
  }

  accessTokenVariants() {
    const raw = String(this.accessToken || "").trim();
    if (!raw) return [];
    const variants = [];
    const pushUnique = (value) => {
      if (value && !variants.includes(value)) {
        variants.push(value);
      }
    };

    pushUnique(raw);
    if (/^Bearer\s+/i.test(raw)) {
      pushUnique(raw.replace(/^Bearer\s+/i, "").trim());
    } else {
      pushUnique(`Bearer ${raw}`);
    }

    return variants;
  }

  async fetchWithAuth(url, options = {}) {
    const headers = {
      ...this.authHeaders(),
      ...(options.headers || {})
    };

    return fetch(url, {
      ...options,
      headers
    });
  }

  /**
   * Connect to streaming session
   * @param {Object} config - Connection config
   * @param {string} config.homeUrl - Base URL
   * @param {string} config.accessToken - Access token
   * @param {string} config.authDataToken - Auth data token
   * @param {string} config.preferredCodec - Preferred codec (auto/av1/h264)
   * @param {string[]} config.sessionQueries - Session query candidates (JWT query strings)
   * @param {string[]} config.gateways - Optional gateway list from session start
   */
  async connect(config) {
    await this.disconnect({ silent: true });

    this.homeUrl = normalizeBaseUrl(config.homeUrl);
    this.accessToken = config.accessToken.trim();
    this.effectiveAccessToken = this.accessToken;
    this.authDataToken = config.authDataToken.trim();
    this.providedGateways = config.gateways || null;
    
    const rawQueryCandidates = Array.isArray(config.sessionQueries)
      ? config.sessionQueries
      : [config.sessionQuery];
    this.sessionQueryCandidates = rawQueryCandidates
      .filter((query) => typeof query === "string" && query.trim())
      .map((query) => normalizeQuery(query))
      .filter((value, index, list) => list.indexOf(value) === index);

    if (!this.sessionQueryCandidates.length) {
      throw new Error("At least one stream query candidate is required");
    }
    
    // The session query is the FULL query string (may be a JWT token)
    this.sessionQuery = this.sessionQueryCandidates[0];
    this.preferredCodec = (config.preferredCodec || "auto").toLowerCase();

    if (!this.accessToken || !this.authDataToken) {
      throw new Error("Both access_token and boosteroid_auth are required");
    }

    this.setStatus("Authenticating");
    this.log("Starting session connection...");

    // Extract sessionId from the query for metadata
    const params = new URLSearchParams(this.sessionQuery.replace(/^\?/, ""));
    this.sessionId = params.get("sessionId") || params.get("sessionid") || "";
    
    // Also try to decode JWT if the query string looks like one
    if (!this.sessionId && this.sessionQuery.length > 100) {
      try {
        const jwt = this.sessionQuery.replace(/^\?/, "");
        // Use a safe base64 decode
        const base64 = jwt.split('.')[1];
        if (base64) {
          const decoded = JSON.parse(
            typeof Buffer !== 'undefined' 
              ? Buffer.from(base64, 'base64').toString()
              : atob(base64.replace(/-/g, '+').replace(/_/g, '/'))
          );
          this.sessionId = decoded.sessionId || decoded.sid || decoded.sub || "";
        }
      } catch (e) {
        // Not a JWT or invalid - that's fine, we'll use the fallback
        this.log(`Query string is not a valid JWT: ${e.message}`);
      }
    }
    
    if (!this.sessionId) {
      // Generate a fallback session ID for logging
      this.sessionId = "unknown-" + Date.now();
    }

    this.log(`Session ID: ${this.sessionId}`);

    // Resolve gateway - use provided gateways from session start or fetch
    const gateway = await this.resolveGatewayAddress();
    this.gatewayHost = normalizeGatewayHost(gateway);
    this.webrtcApiBase = `https://${this.gatewayHost}/webrtc`;

    this.onSessionMeta(this.sessionMeta);
    this.log(`Gateway selected: ${this.gatewayHost}`);

    await this.openControlWebSocket();
    this.installInputHandlers(this.videoElement);
  }

  async disconnect({ silent = false } = {}) {
    this.uninstallInputHandlers();
    this.stopStatsLoop();
    this.stopRemoteIcePolling();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendEvent({ type: "settings", action: "terminating" });
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close(1000, "Disconnected by user");
      } catch {
        // no-op
      }
      this.ws = null;
    }

    if (this.pc) {
      try {
        this.pc.ontrack = null;
        this.pc.onicecandidate = null;
        this.pc.onconnectionstatechange = null;
        this.pc.close();
      } catch {
        // no-op
      }
      this.pc = null;
    }

    if (this.webrtcApiBase && this.peerId && this.sessionId) {
      const hangupUrl = `${this.webrtcApiBase}/api/hangup?peerid=${encodeURIComponent(
        this.peerId
      )}&sessionId=${encodeURIComponent(this.sessionId)}`;
      fetch(hangupUrl).catch(() => undefined);
    }

    this.peerId = "";
    this.remoteIceDedup.clear();
    this.statsPrev = null;
    this.providedGateways = null;

    if (!silent) {
      this.setStatus("Disconnected");
      this.log("Disconnected");
      this.onSessionMeta({ sessionId: "-", gatewayHost: "-" });
    }
  }

  /**
   * Resolve gateway address - use provided gateways from session start response
   * or fall back to fetching from API
   */
  async resolveGatewayAddress() {
    // First try to use gateways provided from session start response
    if (this.providedGateways) {
      const gateway = await selectBestGateway(this.providedGateways);
      if (gateway) {
        this.log("Using gateway from session start response");
        return gateway;
      }
    }

    // Fall back to fetching gateways list
    this.log("Fetching gateway list from API...");
    const response = await this.fetchWithAuth(`${this.homeUrl}/api/v1/streaming/gateways`, {
      method: "GET"
    });

    if (!response.ok) {
      throw new Error(
        `Gateway resolution failed: ${response.status} ${response.statusText}`
      );
    }

    const gatewaysPayload = await response.json();
    const firstGateway = pickGatewayAddress(gatewaysPayload);

    if (!firstGateway) {
      throw new Error("No gateway addresses were returned by /api/v1/streaming/gateways");
    }

    return firstGateway;
  }

  async checkAv1Support() {
    try {
      if (!("mediaCapabilities" in navigator)) {
        return false;
      }

      const screenWidth = Math.max(1280, window.innerWidth);
      const screenHeight = Math.max(720, window.innerHeight);

      const config = {
        type: "media-source",
        video: {
          contentType: "video/webm; codecs=av01.0.08M.08",
          width: screenWidth,
          height: screenHeight,
          bitrate: 10000000,
          framerate: 60
        }
      };

      const result = await navigator.mediaCapabilities.decodingInfo(config);
      return Boolean(result?.supported);
    } catch {
      return false;
    }
  }

  async getSelectedCodec() {
    if (this.preferredCodec === "av1") return "av1";
    if (this.preferredCodec === "h264") return "h264";
    return (await this.checkAv1Support()) ? "av1" : "h264";
  }

  async openControlWebSocket() {
    const codec = await this.getSelectedCodec();
    const width = Math.max(1280, Math.round(window.innerWidth * window.devicePixelRatio));
    const height = Math.max(720, Math.round(window.innerHeight * window.devicePixelRatio));
    const refreshRate = getRefreshRate();
    const platform = detectPlatformCode();

    // The sessionQuery contains the FULL query string (usually a JWT token)
    // This is the base of the WebSocket URL as returned by the session start response
    const baseQuery = this.sessionQuery.replace(/^\?/, "");
    
    // Build the WebSocket URL with the base query string plus resolution params
    let wsUrl = `wss://${this.gatewayHost}/?${baseQuery}`;
    
    // Add resolution and client capability params
    // Note: We need to check if params already exist to avoid duplicates
    const additionalParams = new URLSearchParams();
    additionalParams.set('x', width);
    additionalParams.set('y', height);
    additionalParams.set('lang', this.language);
    additionalParams.set('refreshRate', refreshRate);
    additionalParams.set('rtcEngine', 'webrtc');
    additionalParams.set('clientType', 'web');
    additionalParams.set('devType', 'desktop');
    additionalParams.set('os', platform);
    additionalParams.set('rtcAudio', 'pcm');
    additionalParams.set('codec', codec);
    
    // Append additional params
    wsUrl += '&' + additionalParams.toString();

    this.setStatus("Opening WSS");
    this.log(`Opening control WebSocket (${codec}) to ${this.gatewayHost}`);
    this.log(`WebSocket URL base: wss://${this.gatewayHost}/?${baseQuery.substring(0, 50)}...`);

    await new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
        this.setStatus("WSS connected");
        this.log("Control WebSocket connected");
      };

      ws.onerror = (error) => {
        this.log(`WebSocket error: ${error?.message || 'Unknown error'}`);
        if (!settled) {
          settled = true;
          reject(new Error(`Control WebSocket failed to open: ${wsUrl.substring(0, 100)}...`));
        }
        this.setStatus("WSS error");
      };

      ws.onclose = (event) => {
        this.log(`Control WebSocket closed (${event.code})`);
        this.setStatus("WSS closed");
      };

      ws.onmessage = (event) => {
        this.handleControlMessage(event.data).catch((error) => {
          this.log(`Message handling error: ${error.message}`);
        });
      };
    });
  }

  async handleControlMessage(rawMessage) {
    const message = safeParseJson(rawMessage);
    if (!message) {
      this.log(`Non-JSON message received: ${rawMessage}`);
      return;
    }

    const { type, action } = message;

    if (type === "settings" && action === "webrtc") {
      this.log("Received settings:webrtc, starting WebRTC transport");
      await this.startWebRtcTransport();
      return;
    }

    if (type === "settings" && action === "streamIds") {
      this.log("Received settings:streamIds (Janus path is not implemented in this build)");
      return;
    }

    if (type === "stream" && action === "getstatus") {
      this.sendEvent({
        type: "stream",
        action: "status",
        value: {
          page: "visible",
          network_type: navigator.connection?.effectiveType || "unknown"
        }
      });
      return;
    }

    if (type === "settings" && action === "terminating") {
      this.log("Server requested session termination");
      this.setStatus("Terminating");
      return;
    }

    if (type === "message" && action === "activity") {
      this.log("Server sent inactivity/activity prompt");
      return;
    }

    this.log(`Control message: ${JSON.stringify(message)}`);
  }

  async startWebRtcTransport() {
    if (this.pc) {
      this.log("WebRTC transport already active, skipping");
      return;
    }

    this.peerId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    const iceServers = await this.fetchIceServers();
    const pcConfig = { iceServers };

    this.pc = new RTCPeerConnection(pcConfig);

    this.pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.videoElement.srcObject = stream;
      }
    };

    this.pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.sendLocalIceCandidate(event.candidate).catch((error) => {
        this.log(`sendLocalIceCandidate failed: ${error.message}`);
      });
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      this.log(`WebRTC state: ${state}`);

      if (state === "connected") {
        this.setStatus("Streaming");
        this.sendEvent({ type: "settings", action: "ready" });
        this.startStatsLoop();
      }

      if (state === "failed" || state === "disconnected") {
        this.setStatus("WebRTC degraded");
      }
    };

    this.pc.addTransceiver("video", { direction: "recvonly" });
    this.pc.addTransceiver("audio", { direction: "recvonly" });

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const answer = await this.sendOffer(offer);
    await this.pc.setRemoteDescription(answer);

    this.startRemoteIcePolling();
    this.log("WebRTC negotiation complete");
  }

  async fetchIceServers() {
    const url = `${this.webrtcApiBase}/api/getIceServers?sessionId=${encodeURIComponent(
      this.sessionId
    )}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.log(
          `getIceServers failed (${response.status}), using default Google STUN`
        );
        return DEFAULT_ICE_SERVERS;
      }
      const payload = await response.json();

      if (Array.isArray(payload)) {
        return payload;
      }
      if (Array.isArray(payload?.iceServers)) {
        return payload.iceServers;
      }
      if (Array.isArray(payload?.data?.iceServers)) {
        return payload.data.iceServers;
      }
      if (Array.isArray(payload?.data)) {
        return payload.data;
      }
      return DEFAULT_ICE_SERVERS;
    } catch (error) {
      this.log(`getIceServers error: ${error.message}`);
      return DEFAULT_ICE_SERVERS;
    }
  }

  async sendOffer(offer) {
    const url =
      `${this.webrtcApiBase}/api/call` +
      `?peerid=${encodeURIComponent(this.peerId)}` +
      `&sessionId=${encodeURIComponent(this.sessionId)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(offer)
    });

    if (!response.ok) {
      throw new Error(`Offer rejected: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const answer = payload?.data || payload?.answer || payload;

    if (!answer?.type || !answer?.sdp) {
      throw new Error("Invalid answer payload from /api/call");
    }

    return new RTCSessionDescription(answer);
  }

  async sendLocalIceCandidate(candidate) {
    const url =
      `${this.webrtcApiBase}/api/addIceCandidate` +
      `?peerid=${encodeURIComponent(this.peerId)}` +
      `&sessionId=${encodeURIComponent(this.sessionId)}`;

    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(candidate)
    });
  }

  startRemoteIcePolling() {
    this.stopRemoteIcePolling();

    this.remoteIceInterval = setInterval(async () => {
      if (!this.pc) return;

      const url =
        `${this.webrtcApiBase}/api/getIceCandidate` +
        `?peerid=${encodeURIComponent(this.peerId)}` +
        `&sessionId=${encodeURIComponent(this.sessionId)}`;

      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const payload = await response.json();

        const candidates = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
            ? payload.data
            : payload?.candidate
              ? [payload.candidate]
              : [];

        for (const candidate of candidates) {
          if (!candidate) continue;
          const key = JSON.stringify(candidate);
          if (this.remoteIceDedup.has(key)) continue;
          this.remoteIceDedup.add(key);

          await this.pc.addIceCandidate(candidate).catch(() => undefined);
        }
      } catch {
        // Polling is best effort.
      }
    }, 500);
  }

  stopRemoteIcePolling() {
    if (this.remoteIceInterval) {
      clearInterval(this.remoteIceInterval);
      this.remoteIceInterval = null;
    }
  }

  sendEvent(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify(data));
  }

  sendRttEvent(data) {
    this.eventCount += 1;
    if (this.eventCount >= 20) {
      data.time = Date.now();
      this.eventCount = 0;
    }
    this.sendEvent(data);
  }

  installInputHandlers(target) {
    if (this.inputInstalled) return;
    this.inputInstalled = true;

    target.tabIndex = 0;

    this.handlers.click = () => {
      target.focus();
      if (document.pointerLockElement !== target) {
        target.requestPointerLock?.().catch(() => undefined);
      }
    };

    this.handlers.mousemove = (event) => {
      const rect = target.getBoundingClientRect();
      const x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
      const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);

      this.sendRttEvent({
        type: "mouse",
        action: "move",
        X: Number(x.toFixed(4)),
        Y: Number(y.toFixed(4)),
        isVisible: document.pointerLockElement !== target,
        offsetX: event.movementX || 0,
        offsetY: event.movementY || 0
      });
    };

    this.handlers.mousedown = (event) => {
      event.preventDefault();
      this.sendRttEvent({
        type: "mouse",
        action: "button",
        isPressed: true,
        btn: event.button
      });
    };

    this.handlers.mouseup = (event) => {
      event.preventDefault();
      this.sendRttEvent({
        type: "mouse",
        action: "button",
        isPressed: false,
        btn: event.button
      });
    };

    this.handlers.wheel = (event) => {
      event.preventDefault();
      this.sendRttEvent({
        type: "mouse",
        action: "wheel",
        deltaY: Math.sign(event.deltaY || 0)
      });
    };

    this.handlers.keydown = (event) => {
      if (document.activeElement !== target && document.pointerLockElement !== target) {
        return;
      }
      event.preventDefault();
      this.sendRttEvent({
        type: "keyboard",
        action: "button",
        isPressed: true,
        code: mapKeyCode(event)
      });
    };

    this.handlers.keyup = (event) => {
      if (document.activeElement !== target && document.pointerLockElement !== target) {
        return;
      }
      event.preventDefault();
      this.sendRttEvent({
        type: "keyboard",
        action: "button",
        isPressed: false,
        code: mapKeyCode(event)
      });
    };

    target.addEventListener("click", this.handlers.click);
    target.addEventListener("mousemove", this.handlers.mousemove);
    target.addEventListener("mousedown", this.handlers.mousedown);
    target.addEventListener("mouseup", this.handlers.mouseup);
    target.addEventListener("wheel", this.handlers.wheel, { passive: false });
    window.addEventListener("keydown", this.handlers.keydown);
    window.addEventListener("keyup", this.handlers.keyup);

    this.sendEvent({ type: "mouse", action: "connected" });
    this.sendEvent({ type: "keyboard", action: "connected" });
  }

  uninstallInputHandlers() {
    if (!this.inputInstalled || !this.videoElement) return;
    const target = this.videoElement;

    target.removeEventListener("click", this.handlers.click);
    target.removeEventListener("mousemove", this.handlers.mousemove);
    target.removeEventListener("mousedown", this.handlers.mousedown);
    target.removeEventListener("mouseup", this.handlers.mouseup);
    target.removeEventListener("wheel", this.handlers.wheel);
    window.removeEventListener("keydown", this.handlers.keydown);
    window.removeEventListener("keyup", this.handlers.keyup);

    this.handlers = {};
    this.inputInstalled = false;
  }

  startStatsLoop() {
    this.stopStatsLoop();

    this.statsInterval = setInterval(async () => {
      if (!this.pc) return;

      try {
        const stats = await this.pc.getStats();
        for (const report of stats.values()) {
          if (report.type !== "inbound-rtp" || report.kind !== "video") continue;

          if (!this.statsPrev) {
            this.statsPrev = {
              timestamp: report.timestamp,
              bytesReceived: report.bytesReceived || 0,
              framesDecoded: report.framesDecoded || 0,
              framesReceived: report.framesReceived || 0,
              packetsReceived: report.packetsReceived || 0,
              packetsLost: report.packetsLost || 0
            };
            return;
          }

          const elapsedSec = Math.max(
            0.001,
            (report.timestamp - this.statsPrev.timestamp) / 1000
          );
          const bytesDiff = (report.bytesReceived || 0) - this.statsPrev.bytesReceived;
          const decodedDiff = (report.framesDecoded || 0) - this.statsPrev.framesDecoded;
          const recvDiff = (report.framesReceived || 0) - this.statsPrev.framesReceived;
          const lostDiff = (report.packetsLost || 0) - this.statsPrev.packetsLost;
          const packetsDiff =
            (report.packetsReceived || 0) - this.statsPrev.packetsReceived;

          const bitrate = Math.max(0, Math.round((bytesDiff * 8) / elapsedSec));
          const framerateDecoded = Math.max(0, Math.round(decodedDiff / elapsedSec));
          const framerateReceived = Math.max(0, Math.round(recvDiff / elapsedSec));
          const lossPacket =
            packetsDiff > 0
              ? Number(((Math.max(0, lostDiff) * 100) / packetsDiff).toFixed(2))
              : 0;

          this.sendEvent({
            type: "stream",
            action: "bitrate",
            realBitrate: bitrate,
            framerateDecoded,
            framerateReceived,
            lossPacket,
            time: Date.now()
          });

          this.statsPrev = {
            timestamp: report.timestamp,
            bytesReceived: report.bytesReceived || 0,
            framesDecoded: report.framesDecoded || 0,
            framesReceived: report.framesReceived || 0,
            packetsReceived: report.packetsReceived || 0,
            packetsLost: report.packetsLost || 0
          };
          return;
        }
      } catch {
        // no-op
      }
    }, 1000);
  }

  stopStatsLoop() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.statsPrev = null;
  }
}
