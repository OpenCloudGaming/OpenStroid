import type { LoginCredentials } from '../types';

export function buildLoginPayload(credentials: LoginCredentials): Record<string, string> {
  return {
    email: credentials.email,
    password: credentials.password,
  };
}
