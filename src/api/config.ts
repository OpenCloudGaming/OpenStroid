export const API_CONFIG = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || '',
  endpoints: {
    login: '/auth/login',
    logout: '/auth/logout',
    session: '/auth/session',
    me: '/me',
    installedGames: '/library/installed',
  },
  turnstileSiteKey:
    import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAAB83Vz-GpH08brQi',
} as const;
