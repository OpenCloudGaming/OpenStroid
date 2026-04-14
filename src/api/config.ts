export const API_CONFIG = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || '',
  endpoints: {
    loginStart: '/auth/login/start',
    loginStatus: '/auth/login/status',
    loginCancel: '/auth/login/cancel',
    loginDebugCapture: '/auth/debug/capture',
    logout: '/auth/logout',
    session: '/auth/session',
    me: '/me',
    installedGames: '/library/installed',
  },
} as const;
