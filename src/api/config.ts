function normalizeApiBaseUrl(rawValue: string | undefined): string {
  if (import.meta.env.DEV) {
    return '';
  }

  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const normalizedUrl = new URL(trimmed);
    const hostname = normalizedUrl.hostname.toLowerCase();

    if (hostname === 'boosteroid.com' || hostname.endsWith('.boosteroid.com')) {
      return '';
    }

    return normalizedUrl.origin;
  } catch {
    return '';
  }
}

export const API_CONFIG = {
  baseUrl: normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL),
  endpoints: {
    qrLoginStart: '/auth/login/qr/start',
    qrLoginStatus: '/auth/login/qr/status',
    qrLoginCancel: '/auth/login/qr/cancel',
    loginStart: '/auth/login/start',
    loginStatus: '/auth/login/status',
    loginCancel: '/auth/login/cancel',
    loginDebugCapture: '/auth/debug/capture',
    logout: '/auth/logout',
    session: '/auth/session',
    me: '/me',
    installedGames: '/library/installed',
    libraryDashboard: '/library/dashboard',
    libraryCatalog: '/library/catalog',
    librarySearch: '/library/search',
    libraryNew: '/library/new',
    libraryCarousel: '/library/carousel',
    libraryFacets: '/library/facets',
    libraryApps: '/library/apps',
    librarySync: '/library/sync',
    streamLaunch: '/api/stream/launch',
    streamDequeue: '/stream/dequeue',
    streamActiveSessions: '/stream/sessions/active',
    streamLastSession: '/stream/sessions/last',
    streamLiveSession: '/stream/sessions/live',
    streamGateways: '/stream/gateways',
    streamSessionLog: '/stream/session/log',
    streamSessionEvaluation: '/stream/session/evaluation',
  },
} as const;
