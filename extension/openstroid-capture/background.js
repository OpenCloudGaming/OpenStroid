const DEFAULT_BACKEND_BASE_URL = 'http://localhost:3001';
const AUTH_COOKIE_NAMES = ['access_token', 'refresh_token', 'boosteroid_auth', 'qr_auth_code'];
const RELEVANT_PATH_PATTERNS = [
  '/api/v1/auth/login',
  '/api/v1/auth/refresh-token',
  '/api/v2/auth/logout',
  '/api/v1/user',
  '/api/v1/boostore/applications/installed',
  '/auth',
  '/login',
  '/session',
];
const MAX_EVENTS = 120;

let observedResponses = [];
let lastSubmittedCaptureId = null;
let submissionInFlight = false;

function isRelevantUrl(url) {
  return RELEVANT_PATH_PATTERNS.some((pattern) => url.includes(pattern));
}

function pushObservedEvent(event) {
  observedResponses.push(event);
  if (observedResponses.length > MAX_EVENTS) {
    observedResponses = observedResponses.slice(-MAX_EVENTS);
  }
}

async function getBackendBaseUrl() {
  const stored = await chrome.storage.local.get(['backendBaseUrl']);
  return stored.backendBaseUrl || DEFAULT_BACKEND_BASE_URL;
}

async function getActiveCapture() {
  const backendBaseUrl = await getBackendBaseUrl();
  const response = await fetch(`${backendBaseUrl}/auth/extension/active`);
  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return { backendBaseUrl, data };
}

async function collectCookiesForDomain(domain) {
  return chrome.cookies.getAll({ domain }).then((cookies) => cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: typeof cookie.expirationDate === 'number' ? cookie.expirationDate : -1,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite || 'unspecified',
  })));
}

async function collectRelevantCookies() {
  const cookies = [
    ...(await collectCookiesForDomain('boosteroid.com')),
    ...(await collectCookiesForDomain('cloud.boosteroid.com')),
  ];

  const byKey = new Map();
  for (const cookie of cookies) {
    byKey.set(`${cookie.domain}:${cookie.path}:${cookie.name}`, cookie);
  }

  return [...byKey.values()];
}

async function submitCapture(reason) {
  if (submissionInFlight) {
    return;
  }

  submissionInFlight = true;
  try {
    const active = await getActiveCapture();
    if (!active) {
      return;
    }

    const { backendBaseUrl, data } = active;
    if (lastSubmittedCaptureId === data.id) {
      return;
    }

    const allCookies = await collectRelevantCookies();
    const authCookiePresent = allCookies.some((cookie) => AUTH_COOKIE_NAMES.includes(cookie.name));
    const sawRelevantAuthPayload = observedResponses.some((event) =>
      event.url && (event.url.includes('/api/v1/auth/login') || event.url.includes('/api/v1/auth/refresh-token')),
    );

    if (!authCookiePresent && !sawRelevantAuthPayload) {
      return;
    }

    const payload = {
      id: data.id,
      ingestToken: data.ingestToken,
      finalUrl: observedResponses.at(-1)?.url || data.loginUrl,
      allCookies,
      observedResponses,
      extensionMetadata: {
        reason,
        backendBaseUrl,
        extensionVersion: chrome.runtime.getManifest().version,
        userAgent: navigator.userAgent,
      },
    };

    const response = await fetch(`${backendBaseUrl}/auth/extension/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      lastSubmittedCaptureId = data.id;
    }
  } catch (error) {
    console.error('OpenStroid extension capture failed', error);
  } finally {
    submissionInFlight = false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(['backendBaseUrl']);
  if (!current.backendBaseUrl) {
    await chrome.storage.local.set({ backendBaseUrl: DEFAULT_BACKEND_BASE_URL });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'openstroid:network-event' && message.event?.url && isRelevantUrl(message.event.url)) {
    pushObservedEvent(message.event);
    void submitCapture('page-network-event');
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'openstroid:page-visit' && message.url) {
    pushObservedEvent({
      timestamp: new Date().toISOString(),
      type: 'page',
      source: 'extension',
      url: message.url,
      message: 'Boosteroid page visited in real browser profile.',
    });
    void submitCapture('page-visit');
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'openstroid:get-state') {
    void getBackendBaseUrl().then((backendBaseUrl) => {
      sendResponse({
        backendBaseUrl,
        observedEventCount: observedResponses.length,
        lastSubmittedCaptureId,
      });
    });
    return true;
  }

  if (message?.type === 'openstroid:set-backend-base-url' && typeof message.backendBaseUrl === 'string') {
    void chrome.storage.local.set({ backendBaseUrl: message.backendBaseUrl.trim() || DEFAULT_BACKEND_BASE_URL }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!isRelevantUrl(details.url)) {
      return;
    }

    pushObservedEvent({
      timestamp: new Date().toISOString(),
      type: 'response',
      source: 'extension',
      method: details.method,
      url: details.url,
      status: details.statusCode,
      message: 'Observed relevant response metadata via webRequest.',
    });
    void submitCapture('webrequest-response');
  },
  { urls: ['https://boosteroid.com/*', 'https://*.boosteroid.com/*'] },
);

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (!changeInfo.cookie || !AUTH_COOKIE_NAMES.includes(changeInfo.cookie.name)) {
    return;
  }

  void submitCapture(`cookie:${changeInfo.cookie.name}`);
});
