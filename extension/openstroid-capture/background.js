const DEFAULT_BACKEND_BASE_URL = 'http://127.0.0.1:3001';
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
const MIN_SUBMISSION_INTERVAL_MS = 2500;

let observedResponses = [];
let latestStorageItems = [];
let lastSubmittedCaptureId = null;
let submissionInFlight = false;
let lastSubmissionAttemptAt = 0;
let lastActiveLookup = null;
let lastSubmissionResult = null;

function isRelevantUrl(url) {
  return RELEVANT_PATH_PATTERNS.some((pattern) => url.includes(pattern));
}

function pushObservedEvent(event) {
  observedResponses.push(event);
  if (observedResponses.length > MAX_EVENTS) {
    observedResponses = observedResponses.slice(-MAX_EVENTS);
  }
}

async function getStoredState() {
  const stored = await chrome.storage.local.get(['backendBaseUrl', 'pairingCode']);
  return {
    backendBaseUrl: stored.backendBaseUrl || DEFAULT_BACKEND_BASE_URL,
    pairingCode: typeof stored.pairingCode === 'string' ? stored.pairingCode.trim().toUpperCase() : '',
  };
}

async function getActiveCapture() {
  const { backendBaseUrl, pairingCode } = await getStoredState();
  if (!pairingCode) {
    lastActiveLookup = {
      ok: false,
      checkedAt: new Date().toISOString(),
      message: 'No pairing code saved.',
    };
    return null;
  }

  try {
    const response = await fetch(`${backendBaseUrl}/auth/extension/active`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pairingCode }),
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      lastActiveLookup = {
        ok: false,
        checkedAt: new Date().toISOString(),
        status: response.status,
        message: errorPayload?.message || 'No active capture session found.',
      };
      return null;
    }

    const data = await response.json();
    lastActiveLookup = {
      ok: true,
      checkedAt: new Date().toISOString(),
      id: data.id,
      timeoutAt: data.timeoutAt,
    };
    return { backendBaseUrl, pairingCode, data };
  } catch (error) {
    lastActiveLookup = {
      ok: false,
      checkedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    };
    return null;
  }
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
    lastSubmissionResult = {
      ok: false,
      submittedAt: new Date().toISOString(),
      reason,
      message: 'Submission already in flight.',
    };
    return;
  }

  submissionInFlight = true;
  try {
    const active = await getActiveCapture();
    if (!active) {
      lastSubmissionResult = {
        ok: false,
        submittedAt: new Date().toISOString(),
        reason,
        message: 'No active capture session for the saved pairing code.',
      };
      return;
    }

    const { backendBaseUrl, pairingCode, data } = active;
    if (lastSubmittedCaptureId === data.id) {
      lastSubmissionResult = {
        ok: true,
        submittedAt: new Date().toISOString(),
        reason,
        id: data.id,
        status: 'already_succeeded',
      };
      return;
    }

    const allCookies = await collectRelevantCookies();
    const sawRelevantAuthPayload = observedResponses.some((event) =>
      event.url && (event.url.includes('/api/v1/auth/login') || event.url.includes('/api/v1/auth/refresh-token')),
    );
    const sawStorageTokenCandidate = latestStorageItems.some((item) =>
      /access|refresh|token|auth|session/i.test(item.key) ||
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(item.value),
    );
    const sawFreshAuthCookieChange = reason.startsWith('cookie:');

    if (!sawRelevantAuthPayload && !sawStorageTokenCandidate && !sawFreshAuthCookieChange) {
      lastSubmissionResult = {
        ok: false,
        submittedAt: new Date().toISOString(),
        reason,
        id: data.id,
        message: 'No fresh auth payload, storage token, or auth cookie change observed yet.',
      };
      return;
    }

    const now = Date.now();
    if (now - lastSubmissionAttemptAt < MIN_SUBMISSION_INTERVAL_MS) {
      lastSubmissionResult = {
        ok: false,
        submittedAt: new Date().toISOString(),
        reason,
        id: data.id,
        message: 'Throttled briefly to avoid duplicate submissions.',
      };
      return;
    }
    lastSubmissionAttemptAt = now;

    const payload = {
      id: data.id,
      ingestToken: data.ingestToken,
      finalUrl: observedResponses.at(-1)?.url || data.loginUrl,
      allCookies,
      observedResponses,
      storageItems: latestStorageItems,
      extensionMetadata: {
        reason,
        backendBaseUrl,
        pairingCode,
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

    const result = await response.json().catch(() => null);
    lastSubmissionResult = {
      ok: response.ok,
      submittedAt: new Date().toISOString(),
      reason,
      id: data.id,
      status: result?.status,
      statusCode: response.status,
      message: result?.message,
    };

    if (response.ok) {
      if (result?.status === 'succeeded') {
        lastSubmittedCaptureId = data.id;
      }
    }
  } catch (error) {
    lastSubmissionResult = {
      ok: false,
      submittedAt: new Date().toISOString(),
      reason,
      message: error instanceof Error ? error.message : String(error),
    };
    console.error('OpenStroid extension capture failed', error);
  } finally {
    submissionInFlight = false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(['backendBaseUrl', 'pairingCode']);
  const nextState = {};
  if (!current.backendBaseUrl) {
    nextState.backendBaseUrl = DEFAULT_BACKEND_BASE_URL;
  }
  if (!current.pairingCode) {
    nextState.pairingCode = '';
  }
  if (Object.keys(nextState).length > 0) {
    await chrome.storage.local.set(nextState);
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

  if (message?.type === 'openstroid:storage-snapshot' && Array.isArray(message.storageItems)) {
    latestStorageItems = message.storageItems.filter((item) =>
      item &&
      (item.area === 'localStorage' || item.area === 'sessionStorage') &&
      typeof item.key === 'string' &&
      typeof item.value === 'string'
    );
    void submitCapture('storage-snapshot');
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'openstroid:get-state') {
    void getStoredState().then(async ({ backendBaseUrl, pairingCode }) => {
      if (pairingCode) {
        await getActiveCapture();
      }
      sendResponse({
        backendBaseUrl,
        pairingCode,
        observedEventCount: observedResponses.length,
        storageItemCount: latestStorageItems.length,
        lastSubmittedCaptureId,
        lastActiveLookup,
        lastSubmissionResult,
      });
    });
    return true;
  }

  if (message?.type === 'openstroid:submit-now') {
    void submitCapture('manual-popup').then(() => {
      sendResponse({ ok: true, lastSubmissionResult });
    });
    return true;
  }

  if (message?.type === 'openstroid:set-settings') {
    const backendBaseUrl = typeof message.backendBaseUrl === 'string' && message.backendBaseUrl.trim()
      ? message.backendBaseUrl.trim()
      : DEFAULT_BACKEND_BASE_URL;
    const pairingCode = typeof message.pairingCode === 'string'
      ? message.pairingCode.trim().toUpperCase()
      : '';
    void chrome.storage.local.set({ backendBaseUrl, pairingCode }).then(() => {
      lastSubmittedCaptureId = null;
      lastActiveLookup = null;
      lastSubmissionResult = null;
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
