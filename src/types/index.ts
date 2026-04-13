export interface LoginCredentials {
  email: string;
  password: string;
  'cf-turnstile-response'?: string;
  remember_me?: boolean;
}

export interface User {
  id: number;
  email: string;
  name?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface AuthSession {
  authenticated: boolean;
  user: User | null;
}

export interface InstalledGame {
  id: number;
  name: string;
  slug?: string;
  icon?: string;
  cover?: string;
  description?: string;
  [key: string]: unknown;
}

export interface ApiError {
  message?: string;
  error_code?: number;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
}
