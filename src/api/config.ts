export const API_CONFIG = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || 'https://cloud.boosteroid.com',
  endpoints: {
    login: '/api/v1/auth/login',
    refreshToken: '/api/v1/auth/refresh-token',
    logout: '/api/v2/auth/logout',
    user: '/api/v1/user',
    installedGames: '/api/v1/boostore/applications/installed',
  },
} as const;
