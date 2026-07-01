function normalizeBaseUrl(homeUrl) {
  const normalized = String(homeUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("Home URL is required");
  }
  return normalized;
}

function toArrayData(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

function parseSessionQueryFromPayload(payload) {
  const data = payload?.data || payload;
  const candidates = [
    data?.query,
    data?.queryString,
    data?.sessionQuery,
    data?.streamingQuery,
    data?.sessionId
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.length > 2) {
      if (value.startsWith("?")) return value;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) {
        return `?sessionId=${value}`;
      }
      return `?${value}`;
    }
  }

  const urlCandidates = [data?.url, data?.redirectUrl, data?.streamingUrl];
  for (const value of urlCandidates) {
    if (typeof value === "string" && value.includes("?")) {
      const query = value.slice(value.indexOf("?"));
      if (query.length > 1) return query;
    }
  }

  return null;
}

function normalizeGame(item) {
  const platformObject = item.platform || {};
  const platformLabel =
    item.platformName ||
    platformObject.name ||
    platformObject.key ||
    (typeof item.platform === "string" ? item.platform : "Unknown");

  const genres = Array.isArray(item.genres)
    ? item.genres.map((entry) => entry.name || entry.key || "").filter(Boolean)
    : item.genre
      ? [item.genre]
      : [];

  return {
    id: String(item.id || item.applicationId || item.appId || ""),
    title: item.title || item.name || "Untitled game",
    description: item.shortDescription || item.description || "",
    cover: item.cover || item.image || item.background || "",
    icon: item.icon || "",
    platform: platformLabel,
    genres,
    installed: Boolean(item.installed),
    source: item
  };
}

async function parseError(response) {
  let message = `${response.status} ${response.statusText}`;
  try {
    const body = await response.text();
    if (body) {
      message += `\n${body.slice(0, 500)}`;
    }
  } catch {
    // no-op
  }
  return message;
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeQueryCandidate(value) {
  const str = String(value || "").trim();
  if (!str) return "";
  if (str.startsWith("?")) return str;
  if (str.includes("?")) return str.slice(str.indexOf("?"));
  if (str.includes("=")) return `?${str}`;
  return "";
}

function getSessionIdFromQuery(query) {
  const normalized = normalizeQueryCandidate(query);
  if (!normalized) return "";

  const params = new URLSearchParams(normalized.replace(/^\?/, ""));
  return (
    params.get("sessionId") ||
    params.get("sessionid") ||
    params.get("session") ||
    ""
  );
}

function isSessionQueryCandidate(query) {
  return Boolean(getSessionIdFromQuery(query));
}

function isUuidLike(value) {
  return (
    typeof value === "string" &&
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(
      value
    )
  );
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function isNotReadySessionStatus(status) {
  const value = normalizeStatus(status);
  if (!value) return false;

  const nonReady = new Set([
    "EN",
    "QUEUE",
    "QUEUED",
    "WAIT",
    "WAITING",
    "PENDING",
    "INIT",
    "INITIALIZING",
    "STARTING",
    "CREATING",
    "NEW"
  ]);

  const terminal = new Set([
    "END",
    "ENDED",
    "FINISHED",
    "TERMINATED",
    "TIMEOUT",
    "EXPIRED",
    "FAILED",
    "ERROR",
    "CANCELLED",
    "CANCELED",
    "CLOSED"
  ]);

  return nonReady.has(value) || terminal.has(value);
}

function extractSessionEntries(payload) {
  const entries = [];

  function walkObject(value) {
    if (value == null) return;

    if (Array.isArray(value)) {
      value.forEach(walkObject);
      return;
    }

    if (typeof value !== "object") return;

    const sessionIdCandidates = [value.sessionId, value.sessionID, value.sid].filter(
      isUuidLike
    );

    if (sessionIdCandidates.length) {
      const status =
        value.status ?? value.sessionStatus ?? value.state ?? value.stage ?? "";

      const appIdValue = value.appId ?? value.applicationId ?? value.gameId ?? "";
      const appId =
        appIdValue == null || appIdValue === "" ? "" : String(appIdValue).trim();

      sessionIdCandidates.forEach((sessionId) => {
        entries.push({
          sessionId: String(sessionId).trim(),
          status: normalizeStatus(status),
          appId
        });
      });
    }

    Object.values(value).forEach(walkObject);
  }

  walkObject(payload);
  return entries;
}

function walk(value, visit) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => walk(item, visit));
    return;
  }
  visit(value);
}

function extractSessionIds(payload) {
  const uuidRegex =
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
  const out = [];
  walk(payload, (leaf) => {
    if (typeof leaf !== "string") return;
    const match = leaf.match(uuidRegex);
    if (match) out.push(match[0]);
  });
  return uniq(out);
}

function extractSessionTokens(payload) {
  const out = [];
  const tokenKeyRegex = /^(session)?token$/i;

  function visit(value, key = "") {
    if (value == null) return;

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }

    if (typeof value === "object") {
      for (const [entryKey, entryValue] of Object.entries(value)) {
        visit(entryValue, entryKey);
      }
      return;
    }

    if (typeof value !== "string") return;
    if (!tokenKeyRegex.test(String(key || ""))) return;

    const token = value.trim();
    if (token.length >= 8) {
      out.push(token);
    }
  }

  visit(payload);
  return uniq(out);
}

function extractQueryCandidates(payload) {
  const out = [];
  walk(payload, (leaf) => {
    if (typeof leaf !== "string") return;
    const normalized = normalizeQueryCandidate(leaf);
    if (normalized) out.push(normalized);
  });
  return uniq(out);
}

function normalizeBearerPrefix(value) {
  return String(value || "")
    .replace(/^Bearer\+/i, "Bearer ")
    .replace(/^Bearer%20/i, "Bearer ");
}

function stripBearer(token) {
  return normalizeBearerPrefix(token).replace(/^Bearer\s+/i, "").trim();
}

function toBearer(token) {
  const value = stripBearer(token);
  return value ? `Bearer ${value}` : "";
}

function sortPreferred(list, preferredKeyFn, preferredKeyValue) {
  if (!preferredKeyValue) return list;
  return [...list].sort((a, b) => {
    const pa = preferredKeyFn(a) === preferredKeyValue ? 0 : 1;
    const pb = preferredKeyFn(b) === preferredKeyValue ? 0 : 1;
    return pa - pb;
  });
}

function hasErrorCode(message, code) {
  const text = String(message || "");
  return text.includes(`"error_code":${code}`) || text.includes(`error_code":${code}`);
}

function generateUuidV4() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // no-op
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const rand = Math.floor(Math.random() * 16);
    const val = ch === "x" ? rand : (rand & 0x3) | 0x8;
    return val.toString(16);
  });
}

/**
 * Extract error code from error response
 */
function extractErrorCode(error) {
  const text = String(error?.message || error || "");
  const match = text.match(/"error_code":\s*(\d+)/);
  if (match) return parseInt(match[1], 10);
  
  // Check for direct error code in object
  if (error?.error?.error_code) return error.error.error_code;
  if (error?.error_code) return error.error_code;
  
  return null;
}

/**
 * Parse session start response to extract session info
 */
function parseSessionStartResponse(payload) {
  const data = payload?.data || payload;
  
  return {
    sessionId: data?.sessionId || data?.sessionID || data?.sid || null,
    gateways: data?.gateways || data?.gateway || data?.gw || null,
    query: data?.query || data?.queryString || data?.sessionQuery || null,
    url: data?.url || data?.redirectUrl || data?.streamingUrl || null
  };
}

export class OpenStroidApi {
  constructor({ homeUrl, accessToken, authDataToken, xsrfToken, onLog }) {
    this.homeUrl = normalizeBaseUrl(homeUrl);
    this.accessToken = String(accessToken || "").trim();
    this.authDataToken = String(authDataToken || "").trim();
    this.xsrfToken = String(xsrfToken || "").trim();
    this.onLog = onLog || (() => undefined);

    this.preferredBaseUrl = this.homeUrl;
    this.preferredAuthHeader = "";
    this.preferredUseAuthData = null;
    this.directStartForbidden = false;
    this.useV1Fallback = false;
  }

  log(message) {
    this.onLog(message);
  }

  updateAuth({ homeUrl, accessToken, authDataToken, xsrfToken }) {
    this.homeUrl = normalizeBaseUrl(homeUrl);
    this.accessToken = String(accessToken || "").trim();
    this.authDataToken = String(authDataToken || "").trim();
    this.xsrfToken = String(xsrfToken || "").trim();

    this.preferredBaseUrl = this.homeUrl;
    this.preferredAuthHeader = "";
    this.preferredUseAuthData = null;
    this.directStartForbidden = false;
    this.useV1Fallback = false;
  }

  getEffectiveHomeUrl() {
    return this.preferredBaseUrl || this.homeUrl;
  }

  createSessionToken() {
    return generateUuidV4();
  }

  getBaseUrlCandidates() {
    const values = [this.preferredBaseUrl, this.homeUrl];
    try {
      const url = new URL(this.homeUrl);
      if (url.hostname === "cloud.boosteroid.com") {
        const alt = new URL(this.homeUrl);
        alt.hostname = "boosteroid.com";
        values.push(alt.toString().replace(/\/$/, ""));
      } else if (url.hostname === "boosteroid.com") {
        const alt = new URL(this.homeUrl);
        alt.hostname = "cloud.boosteroid.com";
        values.push(alt.toString().replace(/\/$/, ""));
      }
    } catch {
      // no-op
    }

    return uniq(values.map((value) => String(value || "").replace(/\/+$/, "")));
  }

  getAuthCandidates() {
    const raw = normalizeBearerPrefix(this.accessToken).trim();
    if (!raw) {
      throw new Error("Missing access token");
    }

    const authHeaders = uniq([raw, stripBearer(raw), toBearer(raw)]);
    const useAuthDataVariants = this.authDataToken ? [true, false] : [false];
    const candidates = [];

    for (const authorization of authHeaders) {
      for (const useAuthData of useAuthDataVariants) {
        candidates.push({ authorization, useAuthData });
      }
    }

    let ordered = sortPreferred(
      candidates,
      (item) => `${item.authorization}::${item.useAuthData ? "with" : "without"}`,
      this.preferredAuthHeader
        ? `${this.preferredAuthHeader}::${this.preferredUseAuthData ? "with" : "without"}`
        : ""
    );

    return ordered;
  }

  makeHeaders(candidate, { json = true, includeXsrf = false } = {}) {
    const headers = {
      Accept: "application/json",
      Authorization: candidate.authorization
    };

    if (json) {
      headers["Content-Type"] = "application/json";
    }
    if (candidate.useAuthData && this.authDataToken) {
      headers["Authorization-Data"] = this.authDataToken;
    }
    if (includeXsrf && this.xsrfToken) {
      headers["X-XSRF-TOKEN"] = this.xsrfToken;
    }

    return headers;
  }

  async requestAuthed(path, options = {}) {
    const {
      method = "GET",
      json = true,
      includeXsrf = false,
      body = undefined
    } = options;

    const baseUrls = this.getBaseUrlCandidates();
    const authCandidates = this.getAuthCandidates();
    const unauthorized = [];

    for (const baseUrl of baseUrls) {
      for (const authCandidate of authCandidates) {
        const headers = this.makeHeaders(authCandidate, { json, includeXsrf });
        const url = `${baseUrl}${path}`;

        let response;
        try {
          response = await fetch(url, {
            method,
            headers,
            body
          });
        } catch (error) {
          unauthorized.push(`${url} -> network error: ${error.message}`);
          continue;
        }

        if (response.ok) {
          this.preferredBaseUrl = baseUrl;
          this.preferredAuthHeader = authCandidate.authorization;
          this.preferredUseAuthData = authCandidate.useAuthData;
          return response;
        }

        if (response.status === 401 || response.status === 403) {
          const detail = await parseError(response);
          unauthorized.push(`${url} -> ${detail}`);
          continue;
        }

        const details = await parseError(response);
        throw new Error(`${path} failed: ${details}`);
      }
    }

    throw new Error(
      `${path} failed: all auth/host variants rejected.\n${unauthorized.slice(0, 8).join("\n")}`
    );
  }

  async getUser() {
    const response = await this.requestAuthed("/api/v1/user", {
      method: "GET",
      json: false
    });
    return response.json();
  }

  async getGames({ scope = "installed", search = "", orderBy = "" } = {}) {
    const baseParams = new URLSearchParams();
    const safeOrder = orderBy || "popularity";

    if (scope === "search" && search.trim()) {
      baseParams.set("search", search.trim());
      baseParams.set("page", "1");
      baseParams.set("per_page", "100");
    } else {
      baseParams.set("limit", "100");
      baseParams.set("offset", "0");
      if (search.trim()) {
        baseParams.set("search", search.trim());
      }
    }

    const pathMap = {
      installed: "/api/v1/boostore/applications/installed",
      all: "/api/v1/boostore/applications",
      search: "/api/v1/boostore/applications/search"
    };
    const path = pathMap[scope] || pathMap.installed;

    const orderCandidates = uniq(["popularity", safeOrder, "new", "az", "za", "recent"]);
    const primaryOrderParam = scope === "search" ? "order" : "orderBy";
    const orderParamCandidates = [primaryOrderParam, "orderBy", "order", null];
    const errors = [];

    for (const orderParam of orderParamCandidates) {
      for (const orderValue of orderCandidates) {
        const params = new URLSearchParams(baseParams);
        if (orderParam) {
          params.set(orderParam, orderValue);
        }

        const query = params.toString();
        const fullPath = query ? `${path}?${query}` : path;

        try {
          const response = await this.requestAuthed(fullPath, {
            method: "GET",
            json: false
          });

          if (orderParam && orderValue !== safeOrder) {
            this.log(`Using fallback sort ${orderParam}=${orderValue} for ${scope}`);
          } else if (!orderParam) {
            this.log(`Using fallback without order param for ${scope}`);
          }

          const payload = await response.json();
          return toArrayData(payload).map(normalizeGame).filter((item) => item.id);
        } catch (error) {
          const message = String(error?.message || error);
          errors.push(message);

          if (
            message.toLowerCase().includes("order by is invalid") ||
            message.toLowerCase().includes("selected order by is invalid")
          ) {
            continue;
          }

          if (!message.includes("422")) {
            throw error;
          }
        }
      }
    }

    throw new Error(
      `Failed to load games after trying order fallbacks.\n${errors.slice(0, 8).join("\n")}`
    );
  }

  async checkStreamingPossibility() {
    try {
      const response = await this.requestAuthed("/api/v1/streaming/user/possibility", {
        method: "GET",
        json: false
      });
      return response.json();
    } catch {
      return null;
    }
  }

  /**
   * Join the streaming queue (official Boosteroid flow)
   * POST /api/v2/streaming/session/enqueue
   */
  async enqueueSession(gameId) {
    const game = String(gameId || "").trim();
    if (!game) {
      throw new Error("Game ID is required");
    }
    const numericGameId = Number(game);
    const appId = Number.isFinite(numericGameId) ? numericGameId : game;

    const path = "/api/v2/streaming/session/enqueue";
    this.log(`Enqueue session: POST ${path}`);

    try {
      const response = await this.requestAuthed(path, {
        method: "POST",
        includeXsrf: true,
        body: JSON.stringify({ appId })
      });

      const payload = await response.json().catch(() => ({}));
      return {
        ok: true,
        endpoint: path,
        payload,
        appId
      };
    } catch (error) {
      const errorCode = extractErrorCode(error);
      
      // 340006 = Queue conflict, fallback to V1 needed
      if (errorCode === 340006) {
        this.log("Queue conflict (340006), will use V1 API fallback");
        this.useV1Fallback = true;
      }
      
      return {
        ok: false,
        error: String(error?.message || error),
        errorCode,
        endpoint: path
      };
    }
  }

  /**
   * Start streaming session V2 (official Boosteroid flow)
   * POST /api/v2/streaming/session/start
   * Requires sessionToken from queue WebSocket message
   */
  async startStreamingSessionV2(gameId, sessionToken) {
    const game = String(gameId || "").trim();
    const token = String(sessionToken || "").trim();
    
    if (!game) {
      throw new Error("Game ID is required");
    }
    if (!token) {
      throw new Error("sessionToken is required");
    }
    
    const numericGameId = Number(game);
    const appId = Number.isFinite(numericGameId) ? numericGameId : game;

    if (this.directStartForbidden) {
      return {
        ok: false,
        error: "Direct session start is forbidden for this account (340007).",
        errorCode: 340007
      };
    }

    const path = "/api/v2/streaming/session/start";
    this.log(`Start session V2: POST ${path}`);

    try {
      const response = await this.requestAuthed(path, {
        method: "POST",
        includeXsrf: true,
        body: JSON.stringify({ appId, sessionToken: token })
      });

      const payload = await response.json().catch(() => ({}));
      const sessionInfo = parseSessionStartResponse(payload);
      
      return {
        ok: true,
        endpoint: path,
        payload,
        sessionInfo,
        appId
      };
    } catch (error) {
      const errorCode = extractErrorCode(error);
      
      // 340007 = Direct start forbidden, enqueue-only mode
      if (errorCode === 340007) {
        this.directStartForbidden = true;
        this.log("Direct V2 session start forbidden (340007), enqueue-only mode enabled");
      }
      
      return {
        ok: false,
        error: String(error?.message || error),
        errorCode,
        endpoint: path
      };
    }
  }

  /**
   * Start streaming session V1 (fallback for error 340006)
   * POST /api/v1/streaming/session/start
   */
  async startStreamingSessionV1(gameId) {
    const game = String(gameId || "").trim();
    if (!game) {
      throw new Error("Game ID is required");
    }
    
    const numericGameId = Number(game);
    const appId = Number.isFinite(numericGameId) ? numericGameId : game;

    const path = "/api/v1/streaming/session/start";
    this.log(`Start session V1 (fallback): POST ${path}`);

    try {
      const response = await this.requestAuthed(path, {
        method: "POST",
        includeXsrf: true,
        body: JSON.stringify({ appId })
      });

      const payload = await response.json().catch(() => ({}));
      const sessionInfo = parseSessionStartResponse(payload);
      
      return {
        ok: true,
        endpoint: path,
        payload,
        sessionInfo,
        appId
      };
    } catch (error) {
      const errorCode = extractErrorCode(error);
      return {
        ok: false,
        error: String(error?.message || error),
        errorCode,
        endpoint: path
      };
    }
  }

  /**
   * Leave the streaming queue
   * POST /api/v2/streaming/session/dequeue
   */
  async dequeueSession() {
    try {
      await this.requestAuthed("/api/v2/streaming/session/dequeue", {
        method: "POST",
        includeXsrf: true,
        body: JSON.stringify({})
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  /**
   * Get list of streaming gateways
   */
  async getGateways() {
    try {
      const response = await this.requestAuthed("/api/v1/streaming/gateways", {
        method: "GET",
        json: false
      });
      return response.json();
    } catch (error) {
      return null;
    }
  }

  /**
   * Get active user sessions
   */
  async getActiveSessions() {
    try {
      const response = await this.requestAuthed("/api/v1/streaming/user/active-sessions", {
        method: "GET",
        json: false
      });
      return response.json();
    } catch (error) {
      return null;
    }
  }

  /**
   * Get last session info
   */
  async getLastSession() {
    try {
      const response = await this.requestAuthed("/api/v1/streaming/user/last-session", {
        method: "GET",
        json: false
      });
      return response.json();
    } catch (error) {
      return null;
    }
  }

  /**
   * Get live last session info
   */
  async getLastSessionLive() {
    try {
      const response = await this.requestAuthed("/api/v1/streaming/user/last-session/live", {
        method: "GET",
        json: false
      });
      return response.json();
    } catch (error) {
      return null;
    }
  }

  buildSessionQueriesFromPayload(gameId, payload, options = {}) {
    const game = String(gameId || "").trim();
    const allowNonReady = Boolean(options.allowNonReady);
    const queries = [];
    const push = (value) => {
      const normalized = normalizeQueryCandidate(value);
      if (!normalized) return;
      if (!isSessionQueryCandidate(normalized)) return;
      if (!queries.includes(normalized)) {
        queries.push(normalized);
      }
    };

    const entries = extractSessionEntries(payload);
    entries.forEach((entry) => {
      if (game && entry.appId && entry.appId !== game) return;
      if (!allowNonReady && isNotReadySessionStatus(entry.status)) return;

      push(`?sessionId=${entry.sessionId}`);
      if (game) {
        push(`?sessionId=${entry.sessionId}&appId=${encodeURIComponent(game)}`);
      }
    });

    extractQueryCandidates(payload).forEach(push);
    return queries;
  }

  async tryOptional(path) {
    try {
      const response = await this.requestAuthed(path, {
        method: "GET",
        json: false
      });
      return response.json().catch(() => null);
    } catch {
      return null;
    }
  }

  async discoverSessionQueries(gameId, startPayload, options = {}) {
    const game = String(gameId || "").trim();
    const includeMeta = Boolean(options.includeMeta);
    const candidates = [];
    const blockedSessionIds = new Set();
    const sessionTokens = [];
    const queuedSessionIds = [];
    const pushToken = (value) => {
      const token = String(value || "").trim();
      if (!token) return;
      if (!sessionTokens.includes(token)) {
        sessionTokens.push(token);
      }
    };
    const pushQueuedSessionId = (value) => {
      const sessionId = String(value || "").trim();
      if (!sessionId) return;
      if (!queuedSessionIds.includes(sessionId)) {
        queuedSessionIds.push(sessionId);
      }
    };
    const blockSessionId = (sessionId) => {
      if (!sessionId) return;
      blockedSessionIds.add(sessionId);

      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidateSessionId = getSessionIdFromQuery(candidates[index]);
        if (candidateSessionId && candidateSessionId === sessionId) {
          candidates.splice(index, 1);
        }
      }
    };

    const push = (value) => {
      const normalized = normalizeQueryCandidate(value);
      if (!normalized) return;
      if (!isSessionQueryCandidate(normalized)) return;

      const sessionId = getSessionIdFromQuery(normalized);
      if (sessionId && blockedSessionIds.has(sessionId)) return;

      if (!candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    };

    const ingestPayload = (payload) => {
      const entries = extractSessionEntries(payload);
      entries.forEach((entry) => {
        if (game && entry.appId && entry.appId !== game) return;

        if (isNotReadySessionStatus(entry.status)) {
          pushQueuedSessionId(entry.sessionId);
          blockSessionId(entry.sessionId);
          return;
        }

        push(`?sessionId=${entry.sessionId}`);
        if (game) {
          push(`?sessionId=${entry.sessionId}&appId=${encodeURIComponent(game)}`);
        }
      });

      extractSessionTokens(payload).forEach(pushToken);

      this.buildSessionQueriesFromPayload(game, payload).forEach((query) => {
        const sessionId = getSessionIdFromQuery(query);
        if (sessionId && blockedSessionIds.has(sessionId)) return;
        push(query);
      });
    };

    ingestPayload(startPayload);

    const endpoints = [
      "/api/v1/streaming/user/last-session/live",
      "/api/v1/streaming/user/last-session",
      "/api/v1/streaming/user/active-sessions"
    ];

    for (const endpoint of endpoints) {
      const payload = await this.tryOptional(endpoint);
      if (!payload) continue;
      ingestPayload(payload);
    }

    const queries = uniq(candidates);
    if (includeMeta) {
      return {
        queries,
        sessionTokens: uniq(sessionTokens),
        queuedSessionIds: uniq(queuedSessionIds)
      };
    }
    return queries;
  }

  async waitForSessionQueries(gameId, startPayload, options = {}) {
    const timeoutMs = Number(options.timeoutMs || 45000);
    const intervalMs = Number(options.intervalMs || 2000);
    const excludeSessionIds = new Set(
      (options.excludeSessionIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
    const deadline = Date.now() + timeoutMs;
    let best = [];

    while (Date.now() < deadline) {
      const candidates = await this.discoverSessionQueries(gameId, startPayload);
      const filtered = candidates.filter((query) => {
        const sessionId = getSessionIdFromQuery(query);
        return !sessionId || !excludeSessionIds.has(sessionId);
      });

      if (filtered.length) {
        best = filtered;
      }

      const sessionCandidate = filtered.find((query) =>
        getSessionIdFromQuery(query)
      );
      if (sessionCandidate) {
        return filtered;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return best;
  }

  async waitForSessionSignals(gameId, startPayload, options = {}) {
    const timeoutMs = Number(options.timeoutMs || 45000);
    const intervalMs = Number(options.intervalMs || 2000);
    const excludeSessionIds = new Set(
      (options.excludeSessionIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );

    const deadline = Date.now() + timeoutMs;
    let bestQueries = [];
    let bestTokens = [];
    let bestQueuedSessionIds = [];

    while (Date.now() < deadline) {
      const discovery = await this.discoverSessionQueries(gameId, startPayload, {
        includeMeta: true
      });

      const queries = Array.isArray(discovery?.queries) ? discovery.queries : [];
      const tokens = Array.isArray(discovery?.sessionTokens) ? discovery.sessionTokens : [];
      const queuedSessionIds = Array.isArray(discovery?.queuedSessionIds)
        ? discovery.queuedSessionIds
        : [];

      const filteredQueries = queries.filter((query) => {
        const sessionId = getSessionIdFromQuery(query);
        return !sessionId || !excludeSessionIds.has(sessionId);
      });

      if (filteredQueries.length) bestQueries = filteredQueries;
      if (tokens.length) bestTokens = tokens;
      if (queuedSessionIds.length) bestQueuedSessionIds = queuedSessionIds;

      if (
        filteredQueries.some((query) => Boolean(getSessionIdFromQuery(query))) ||
        tokens.length ||
        queuedSessionIds.length
      ) {
        return {
          queries: filteredQueries,
          sessionTokens: tokens,
          queuedSessionIds
        };
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return {
      queries: bestQueries,
      sessionTokens: bestTokens,
      queuedSessionIds: bestQueuedSessionIds
    };
  }
}
