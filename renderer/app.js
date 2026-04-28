import { OpenStroidApi } from "./client/openstroid-api.js";
import { OpenStroidClient } from "./client/openstroid-client.js";

const STORAGE_KEY = "openstroid.connection.v3";

const loginScreen = document.getElementById("login-screen");
const launcherScreen = document.getElementById("launcher-screen");
const waitingScreen = document.getElementById("waiting-screen");
const streamScreen = document.getElementById("stream-screen");

const authForm = document.getElementById("auth-form");
const loginHomeUrl = document.getElementById("home-url");
const loginQueryTemplate = document.getElementById("query-template");
const loginAccessToken = document.getElementById("access-token");
const loginAuthDataToken = document.getElementById("auth-data-token");
const loginXsrfToken = document.getElementById("xsrf-token");
const loginCodec = document.getElementById("codec");

const settingsForm = document.getElementById("settings-form");
const settingsHomeUrl = document.getElementById("settings-home-url");
const settingsQueryTemplate = document.getElementById("settings-query-template");
const settingsAccessToken = document.getElementById("settings-access-token");
const settingsAuthDataToken = document.getElementById("settings-auth-data-token");
const settingsXsrfToken = document.getElementById("settings-xsrf-token");
const settingsCodec = document.getElementById("settings-codec");
const settingsReloadBtn = document.getElementById("settings-reload-btn");

const routeButtons = Array.from(document.querySelectorAll(".route-btn"));
const routePanels = {
  home: document.getElementById("route-home"),
  library: document.getElementById("route-library"),
  settings: document.getElementById("route-settings"),
  logs: document.getElementById("route-logs")
};
const routeKicker = document.getElementById("route-kicker");
const routeTitle = document.getElementById("route-title");
const userBadge = document.getElementById("user-badge");
const logoutBtn = document.getElementById("logout-btn");

const homeSelectedTitle = document.getElementById("home-selected-title");
const homeSelectedMeta = document.getElementById("home-selected-meta");
const homePlayBtn = document.getElementById("home-play-btn");
const homeRefreshBtn = document.getElementById("home-refresh-btn");
const homeFeaturedList = document.getElementById("home-featured-list");
const statAllGames = document.getElementById("stat-all-games");
const statInstalledGames = document.getElementById("stat-installed-games");
const statStreamingReady = document.getElementById("stat-streaming-ready");

const scopeSegment = document.getElementById("scope-segment");
const gameSearchInput = document.getElementById("game-search");
const orderSelect = document.getElementById("order-select");
const refreshGamesBtn = document.getElementById("refresh-games-btn");
const selectedGameLabel = document.getElementById("selected-game");
const gamesList = document.getElementById("games-list");

const statusLabel = document.getElementById("status-label");
const sessionIdValue = document.getElementById("session-id");
const gatewayHostValue = document.getElementById("gateway-host");
const clearLogsBtn = document.getElementById("clear-logs-btn");
const logOutput = document.getElementById("log-output");

const waitingTitle = document.getElementById("waiting-title");
const waitingSubtitle = document.getElementById("waiting-subtitle");

const streamGameTitle = document.getElementById("stream-game-title");
const streamVideo = document.getElementById("stream-video");
const streamOverlay = document.getElementById("overlay-message");
const streamEndBtn = document.getElementById("stream-end-btn");

const state = {
  authenticated: false,
  route: "home",
  scope: "installed",
  config: null,
  user: null,
  api: null,
  selectedGame: null,
  gamesByScope: {
    installed: [],
    all: [],
    search: []
  },
  currentGames: [],
  streaming: false,
  streamingPossibility: null
};

function now() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function logLine(scope, message) {
  logOutput.textContent += `[${now()}] [${scope}] ${message}\n`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

function readSavedConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSavedConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function defaultConfig() {
  return {
    homeUrl: "https://cloud.boosteroid.com",
    queryTemplate: "?appId={id}",
    accessToken: "",
    authDataToken: "",
    xsrfToken: "",
    preferredCodec: "auto"
  };
}

function normalizeConfig(input) {
  const base = defaultConfig();
  return {
    ...base,
    ...(input || {}),
    homeUrl: String(input?.homeUrl || base.homeUrl).trim(),
    queryTemplate: String(input?.queryTemplate || base.queryTemplate).trim(),
    accessToken: String(input?.accessToken || "").trim(),
    authDataToken: String(input?.authDataToken || "").trim(),
    xsrfToken: String(input?.xsrfToken || "").trim(),
    preferredCodec: String(input?.preferredCodec || "auto").trim().toLowerCase()
  };
}

function loginFormConfig() {
  return normalizeConfig({
    homeUrl: loginHomeUrl.value,
    queryTemplate: loginQueryTemplate.value,
    accessToken: loginAccessToken.value,
    authDataToken: loginAuthDataToken.value,
    xsrfToken: loginXsrfToken.value,
    preferredCodec: loginCodec.value
  });
}

function settingsFormConfig() {
  return normalizeConfig({
    homeUrl: settingsHomeUrl.value,
    queryTemplate: settingsQueryTemplate.value,
    accessToken: settingsAccessToken.value,
    authDataToken: settingsAuthDataToken.value,
    xsrfToken: settingsXsrfToken.value,
    preferredCodec: settingsCodec.value
  });
}

function applyConfigToForms(configInput) {
  const config = normalizeConfig(configInput);

  loginHomeUrl.value = config.homeUrl;
  loginQueryTemplate.value = config.queryTemplate;
  loginAccessToken.value = config.accessToken;
  loginAuthDataToken.value = config.authDataToken;
  loginXsrfToken.value = config.xsrfToken;
  loginCodec.value = config.preferredCodec;

  settingsHomeUrl.value = config.homeUrl;
  settingsQueryTemplate.value = config.queryTemplate;
  settingsAccessToken.value = config.accessToken;
  settingsAuthDataToken.value = config.authDataToken;
  settingsXsrfToken.value = config.xsrfToken;
  settingsCodec.value = config.preferredCodec;
}

function setStatus(value) {
  statusLabel.textContent = value;
}

function setSessionMeta({ sessionId, gatewayHost }) {
  sessionIdValue.textContent = sessionId || "-";
  gatewayHostValue.textContent = gatewayHost || "-";
}

function showScreen(target) {
  loginScreen.classList.toggle("active", target === "login");
  launcherScreen.classList.toggle("active", target === "launcher");
}

function setWaiting(active, title = "Starting your game...", subtitle = "Connecting to cloud resources.") {
  waitingScreen.classList.toggle("active", active);
  waitingTitle.textContent = title;
  waitingSubtitle.textContent = subtitle;
}

function setStreamVisible(visible) {
  streamScreen.classList.toggle("active", visible);
  streamOverlay.classList.toggle("hidden", visible);
}

function routeTitleText(route) {
  if (route === "home") return "Welcome";
  if (route === "library") return "My Library";
  if (route === "settings") return "Settings";
  return "Logs";
}

function navigate(route) {
  state.route = route;
  routeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.route === route);
  });

  Object.entries(routePanels).forEach(([key, panel]) => {
    panel.classList.toggle("active", key === route);
  });

  routeKicker.textContent = route.toUpperCase();
  routeTitle.textContent = routeTitleText(route);
}

function setScope(scope) {
  state.scope = scope;
  const buttons = scopeSegment.querySelectorAll(".scope-btn");
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.scope === scope);
  });

  if (scope === "installed") {
    orderSelect.value = "popularity";
  }
}

function buildSessionQuery(sessionId, appId) {
  if (!sessionId) return "";
  let query = `?sessionId=${encodeURIComponent(sessionId)}`;
  if (appId) {
    query += `&appId=${encodeURIComponent(appId)}`;
  }
  return query;
}

function extractSessionIdFromQuery(query) {
  const raw = String(query || "").trim();
  if (!raw) return "";
  const normalized = raw.startsWith("?") ? raw.slice(1) : raw;
  const params = new URLSearchParams(normalized);
  return (
    params.get("sessionId") ||
    params.get("sessionid") ||
    params.get("session") ||
    ""
  );
}

function isRetriableSessionDetailsError(errorMessage) {
  const text = String(errorMessage || "").toLowerCase();
  if (!text.includes("session details")) return false;
  if (!text.includes("406")) return false;
  return (
    text.includes('"code":"timeout"') ||
    text.includes('"code":"external"') ||
    text.includes("timeout!") ||
    text.includes("session has been ended by timeout")
  );
}

function setSelectedGame(game) {
  state.selectedGame = game || null;

  if (!state.selectedGame) {
    selectedGameLabel.textContent = "Selected: none";
    homeSelectedTitle.textContent = "No game selected";
    homeSelectedMeta.textContent = "Go to My Library and choose a game.";
    homePlayBtn.disabled = true;
    streamGameTitle.textContent = "Streaming";
    return;
  }

  const title = state.selectedGame.title || "Unknown game";
  const meta = [state.selectedGame.platform, ...(state.selectedGame.genres || []).slice(0, 2)]
    .filter(Boolean)
    .join(" • ");

  selectedGameLabel.textContent = `Selected: ${title} (${state.selectedGame.id})`;
  homeSelectedTitle.textContent = title;
  homeSelectedMeta.textContent = meta || "Ready to start session";
  homePlayBtn.disabled = state.streaming;
  streamGameTitle.textContent = title;
}

function cardCover(game) {
  const fallback = (game.title || "?").slice(0, 1).toUpperCase();
  const src = game.cover || game.icon;
  if (!src) {
    return `<div class="cover" style="display:grid;place-items:center;color:#7d90b9;font-weight:800;">${fallback}</div>`;
  }
  return `<img class="cover" src="${src}" alt="${game.title}" loading="lazy" />`;
}

function renderFeatured() {
  const installed = state.gamesByScope.installed || [];
  homeFeaturedList.textContent = "";

  if (!installed.length) {
    const empty = document.createElement("article");
    empty.className = "featured-item";
    empty.innerHTML = "<h5>No games found</h5><p>Load your library from active account tokens.</p>";
    homeFeaturedList.appendChild(empty);
    return;
  }

  installed.slice(0, 10).forEach((game) => {
    const item = document.createElement("article");
    item.className = "featured-item";
    item.innerHTML = `
      <h5>${game.title}</h5>
      <p>${game.platform || "unknown platform"}</p>
    `;
    item.addEventListener("click", () => {
      setSelectedGame(game);
      navigate("library");
      renderLibraryGames();
    });
    homeFeaturedList.appendChild(item);
  });
}

function renderLibraryGames() {
  const games = state.currentGames || [];
  gamesList.textContent = "";

  if (!games.length) {
    const empty = document.createElement("article");
    empty.className = "game-item";
    empty.innerHTML = `
      <div class="cover" style="display:grid;place-items:center;color:#7d90b9;font-weight:800;">?</div>
      <div>
        <h5>No games found</h5>
        <p>Try another scope or search query.</p>
      </div>
      <button type="button" class="pick-action" disabled>Select</button>
    `;
    gamesList.appendChild(empty);
    return;
  }

  games.forEach((game) => {
    const active = state.selectedGame?.id === game.id;
    const meta = [game.platform, ...(game.genres || []).slice(0, 2)].filter(Boolean).join(" • ");

    const item = document.createElement("article");
    item.className = `game-item${active ? " active" : ""}`;
    item.innerHTML = `
      ${cardCover(game)}
      <div>
        <h5>${game.title}</h5>
        <p>${meta || "no metadata"}</p>
      </div>
      <button type="button" class="pick-action${active ? " active" : ""}">
        ${active ? "Selected" : "Select"}
      </button>
    `;

    const selectBtn = item.querySelector(".pick-action");
    selectBtn.addEventListener("click", () => {
      setSelectedGame(game);
      renderLibraryGames();
    });

    item.addEventListener("dblclick", () => {
      setSelectedGame(game);
      startSelectedGame().catch((error) => {
        logLine("error", `Start failed: ${error.message}`);
      });
    });

    gamesList.appendChild(item);
  });
}

function updateStats() {
  statAllGames.textContent = String((state.gamesByScope.all || []).length);
  statInstalledGames.textContent = String((state.gamesByScope.installed || []).length);

  if (state.streamingPossibility == null) {
    statStreamingReady.textContent = "unknown";
    return;
  }

  const text = JSON.stringify(state.streamingPossibility).toLowerCase();
  if (text.includes("false") || text.includes("no") || text.includes("unavailable")) {
    statStreamingReady.textContent = "no";
  } else {
    statStreamingReady.textContent = "yes";
  }
}

function ensureApi(config) {
  if (!state.api) {
    state.api = new OpenStroidApi({
      homeUrl: config.homeUrl,
      accessToken: config.accessToken,
      authDataToken: config.authDataToken,
      xsrfToken: config.xsrfToken,
      onLog: (message) => logLine("api", message)
    });
    return;
  }

  state.api.updateAuth({
    homeUrl: config.homeUrl,
    accessToken: config.accessToken,
    authDataToken: config.authDataToken,
    xsrfToken: config.xsrfToken
  });
}

async function loadScope(scope, search = "", orderBy = orderSelect.value) {
  if (!state.api) {
    throw new Error("Not authenticated");
  }

  setStatus(`Loading ${scope}`);
  const games = await state.api.getGames({ scope, search, orderBy });
  state.gamesByScope[scope] = games;
  if (scope === state.scope) {
    state.currentGames = games;
    if (!state.selectedGame && games.length) {
      setSelectedGame(games[0]);
    }
    renderLibraryGames();
  }
  return games;
}

async function refreshLauncherData() {
  if (!state.api) return;

  const search = gameSearchInput.value.trim();
  await Promise.allSettled([
    loadScope("installed", "", "popularity"),
    loadScope("all", "", "popularity")
  ]);

  if (state.scope === "search") {
    await loadScope("search", search, orderSelect.value);
  } else {
    await loadScope(state.scope, search, orderSelect.value);
  }

  state.streamingPossibility = await state.api.checkStreamingPossibility();
  updateStats();
  renderFeatured();
  setStatus("Ready");
}

async function authenticateAndEnter(config) {
  ensureApi(config);
  state.config = config;
  writeSavedConfig(config);

  setStatus("Authenticating");
  logLine("app", "Authenticating...");

  let userLoaded = false;
  try {
    const userPayload = await state.api.getUser();
    state.user = userPayload?.data || userPayload;
    userBadge.textContent = state.user?.name || state.user?.nickname || "authorized";
    userLoaded = true;
  } catch (error) {
    logLine("warn", `User endpoint failed: ${error.message}`);
  }

  await refreshLauncherData();

  if (!userLoaded) {
    userBadge.textContent = "token-ok";
  }

  const resolvedHome = state.api.getEffectiveHomeUrl();
  const updated = { ...config, homeUrl: resolvedHome };
  state.config = updated;
  writeSavedConfig(updated);
  applyConfigToForms(updated);

  state.authenticated = true;
  showScreen("launcher");
  navigate("home");
  logLine("app", "Launcher ready");
}

/**
 * Start streaming session using the official Boosteroid flow:
 * 1. Enqueue to join queue
 * 2. Wait for session signals (sessionId or sessionToken)
 * 3. If sessionToken received, call startStreamingSessionV2
 * 4. Connect to WebRTC with the sessionId
 */
async function startSelectedGame() {
  if (!state.selectedGame || !state.config || !state.api) {
    return;
  }
  if (state.streaming) {
    return;
  }

  const game = state.selectedGame;
  setWaiting(true, `Starting ${game.title}`, "Requesting cloud session...");
  setStatus("Preparing session");
  homePlayBtn.disabled = true;

  let sessionCleanupNeeded = false;

  try {
    // Step 1: Join the queue
    logLine("api", `Enqueueing game ${game.id}...`);
    const enqueueResult = await state.api.enqueueSession(game.id);

    // Handle V1 fallback (error 340006)
    if (!enqueueResult.ok && enqueueResult.errorCode === 340006) {
      logLine("api", "Queue conflict detected, using V1 API fallback...");
      const v1Result = await state.api.startStreamingSessionV1(game.id);
      
      if (!v1Result.ok) {
        throw new Error(`V1 session start failed: ${v1Result.error}`);
      }

      const sessionInfo = v1Result.sessionInfo;
      if (!sessionInfo.sessionId) {
        throw new Error("V1 start response missing sessionId");
      }

      logLine("api", `V1 session started: ${sessionInfo.sessionId}`);
      // Use the full query string (JWT token) from the response for WebSocket auth
      const sessionQuery = sessionInfo.query || buildSessionQuery(sessionInfo.sessionId, game.id);
      await connectToSession(sessionInfo.sessionId, game, sessionInfo.gateways, sessionQuery);
      return;
    }

    if (!enqueueResult.ok) {
      throw new Error(`Enqueue failed: ${enqueueResult.error}`);
    }

    logLine("api", "Queue joined successfully, waiting for session assignment...");
    setWaiting(true, `Starting ${game.title}`, "Queue accepted. Waiting for available machine...");

    // Step 2: Wait for session signals with timeout
    const deadline = Date.now() + 180000; // 3 minutes max wait
    const attemptedTokens = new Set();
    let sessionEstablished = false;
    let reenqueueAttempts = 0;

    while (Date.now() < deadline && !sessionEstablished) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;

      // Poll for session signals
      const signals = await state.api.waitForSessionSignals(
        game.id,
        enqueueResult.payload,
        {
          timeoutMs: Math.min(10000, Math.max(3000, remainingMs)),
          intervalMs: 2000
        }
      );

      const sessionTokens = signals.sessionTokens || [];
      const queries = signals.queries || [];
      const queuedIds = signals.queuedSessionIds || [];

      // Step 3: If we have sessionTokens, try V2 start
      if (sessionTokens.length > 0) {
        for (const token of sessionTokens) {
          if (attemptedTokens.has(token)) continue;
          attemptedTokens.add(token);

          logLine("api", `Trying V2 start with sessionToken...`);
          const v2Result = await state.api.startStreamingSessionV2(game.id, token);

          if (v2Result.ok && v2Result.sessionInfo?.sessionId) {
            logLine("api", `V2 session started: ${v2Result.sessionInfo.sessionId}`);
            // Use the full query string (JWT token) from the response for WebSocket auth
            const sessionQuery = v2Result.sessionInfo.query || buildSessionQuery(v2Result.sessionInfo.sessionId, game.id);
            await connectToSession(v2Result.sessionInfo.sessionId, game, v2Result.sessionInfo.gateways, sessionQuery);
            sessionEstablished = true;
            break;
          }

          // Handle specific error codes
          if (v2Result.errorCode === 340005) {
            logLine("api", "Game launched elsewhere (340005), resetting queue...");
            await state.api.dequeueSession();
            
            if (reenqueueAttempts < 2) {
              reenqueueAttempts++;
              logLine("api", `Re-enqueueing (attempt ${reenqueueAttempts})...`);
              const reenqueue = await state.api.enqueueSession(game.id);
              if (reenqueue.ok) {
                attemptedTokens.clear();
                await new Promise(r => setTimeout(r, 1500));
                continue;
              }
            }
            throw new Error("Game is already running elsewhere. Please close the other session first.");
          }

          if (v2Result.errorCode === 340007) {
            logLine("api", "Account requires queue-only mode (340007), waiting...");
            break;
          }

          if (v2Result.error) {
            logLine("api", `V2 start failed: ${v2Result.error}`);
          }
        }
      }

      // If we have direct session queries, try connecting
      if (!sessionEstablished && queries.length > 0) {
        const sessionQuery = queries.find(q => extractSessionIdFromQuery(q));
        if (sessionQuery) {
          const sessionId = extractSessionIdFromQuery(sessionQuery);
          logLine("api", `Trying direct connection with sessionId: ${sessionId}`);
          
          try {
            await connectToSession(sessionId, game, null, sessionQuery);
            sessionEstablished = true;
            break;
          } catch (connError) {
            logLine("api", `Direct connection failed: ${connError.message}`);
          }
        }
      }

      // Still in queue, update UI
      if (!sessionEstablished && queuedIds.length > 0) {
        setWaiting(true, `Starting ${game.title}`, "Queue position: waiting for available machine...");
      }

      // Wait before next poll
      if (!sessionEstablished) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!sessionEstablished) {
      throw new Error("Timed out waiting for session assignment. Please try again.");
    }

  } catch (error) {
    logLine("error", `Start game failed: ${error.message}`);
    setWaiting(false);
    setStreamVisible(false);
    streamOverlay.classList.remove("hidden");
    streamOverlay.textContent = "Failed to start stream.";
    setStatus("Play failed");
    await streamClient.disconnect({ silent: true });
  } finally {
    homePlayBtn.disabled = state.streaming || !state.selectedGame;
  }
}

/**
 * Connect to streaming session
 * @param {string} sessionId - Session ID for logging/metadata
 * @param {Object} game - Game object
 * @param {string[]} gateways - Optional gateway list
 * @param {string} sessionQuery - Full session query string (JWT token from session start response)
 */
async function connectToSession(sessionId, game, gateways = null, sessionQuery = null) {
  if (!sessionId) {
    throw new Error("No sessionId provided");
  }

  setWaiting(true, `Starting ${game.title}`, "Negotiating stream transport...");

  // Use provided session query (JWT token) or build one from sessionId
  // The JWT token from the session start response is preferred for WebSocket auth
  const finalSessionQuery = sessionQuery || buildSessionQuery(sessionId, game.id);
  logLine("api", `Connecting with session query: ${finalSessionQuery.substring(0, 100)}...`);

  // Connect to WebRTC
  await streamClient.connect({
    homeUrl: state.api.getEffectiveHomeUrl(),
    accessToken: state.config.accessToken,
    authDataToken: state.config.authDataToken,
    preferredCodec: state.config.preferredCodec,
    sessionQueries: [finalSessionQuery],
    gateways: gateways
  });

  state.streaming = true;
  setWaiting(false);
  setStreamVisible(true);
  streamOverlay.classList.add("hidden");
  setStatus("Streaming");
  logLine("app", `Streaming started for ${game.title}`);
}

async function endStreaming() {
  await streamClient.disconnect();
  state.streaming = false;
  setStreamVisible(false);
  setWaiting(false);
  streamOverlay.classList.remove("hidden");
  streamOverlay.textContent = "Loading stream...";
  setSessionMeta({ sessionId: "-", gatewayHost: "-" });
  setStatus("Disconnected");
  homePlayBtn.disabled = !state.selectedGame;
  logLine("app", "Session ended");
}

function logout() {
  endStreaming().catch(() => undefined);
  state.authenticated = false;
  state.route = "home";
  state.user = null;
  userBadge.textContent = "guest";
  showScreen("login");
  navigate("home");
  setStatus("Idle");
  logLine("app", "Logged out");
}

const streamClient = new OpenStroidClient({
  videoElement: streamVideo,
  onLog: (message) => logLine("stream", message),
  onStatus: (status) => {
    setStatus(status);
    if (waitingScreen.classList.contains("active")) {
      waitingSubtitle.textContent = `State: ${status}`;
    }
  },
  onSessionMeta: (meta) => setSessionMeta(meta)
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const config = loginFormConfig();
  try {
    await authenticateAndEnter(config);
  } catch (error) {
    setStatus("Auth error");
    logLine("error", error.message);
  }
});

routeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const route = button.dataset.route;
    navigate(route);
  });
});

homePlayBtn.addEventListener("click", () => {
  startSelectedGame().catch((error) => logLine("error", error.message));
});

homeRefreshBtn.addEventListener("click", async () => {
  if (!state.api) return;
  try {
    await refreshLauncherData();
    logLine("app", "Launcher data refreshed");
  } catch (error) {
    logLine("error", error.message);
  }
});

scopeSegment.addEventListener("click", async (event) => {
  const button = event.target.closest(".scope-btn");
  if (!button || !state.api) return;
  const nextScope = button.dataset.scope;
  if (!nextScope || nextScope === state.scope) return;

  setScope(nextScope);
  try {
    const search = gameSearchInput.value.trim();
    await loadScope(nextScope, search, orderSelect.value);
    setStatus("Ready");
  } catch (error) {
    logLine("error", error.message);
  }
});

refreshGamesBtn.addEventListener("click", async () => {
  if (!state.api) return;
  try {
    await loadScope(state.scope, gameSearchInput.value.trim(), orderSelect.value);
    setStatus("Ready");
  } catch (error) {
    logLine("error", error.message);
  }
});

gameSearchInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" || !state.api) return;
  event.preventDefault();
  try {
    await loadScope(state.scope, gameSearchInput.value.trim(), orderSelect.value);
    setStatus("Ready");
  } catch (error) {
    logLine("error", error.message);
  }
});

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const config = settingsFormConfig();
  state.config = config;
  writeSavedConfig(config);
  applyConfigToForms(config);
  ensureApi(config);
  logLine("app", "Settings saved");
});

settingsReloadBtn.addEventListener("click", async () => {
  if (!state.config) return;
  try {
    await authenticateAndEnter(state.config);
    navigate("settings");
  } catch (error) {
    logLine("error", `Reload failed: ${error.message}`);
  }
});

clearLogsBtn.addEventListener("click", () => {
  logOutput.textContent = "";
});

streamEndBtn.addEventListener("click", () => {
  endStreaming().catch((error) => logLine("error", error.message));
});

logoutBtn.addEventListener("click", () => logout());

window.addEventListener("beforeunload", () => {
  streamClient.disconnect({ silent: true }).catch(() => undefined);
});

const bootConfig = normalizeConfig(readSavedConfig());
state.config = bootConfig;
applyConfigToForms(bootConfig);
showScreen("login");
navigate("home");
setScope("installed");
setSelectedGame(null);
setSessionMeta({ sessionId: "-", gatewayHost: "-" });
setStatus("Idle");
setWaiting(false);
setStreamVisible(false);
logLine("app", "OpenStroid ready");
