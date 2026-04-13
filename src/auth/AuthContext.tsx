import {
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { LoginCredentials, User } from '../types';
import * as api from '../api';
import { AuthContext } from './context';
import { clearLegacyAuthStorage } from './storage';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isBootstrapping: boolean;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  isBootstrapping: true,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  const applySession = useCallback((user: User | null) => {
    setState({
      user,
      isAuthenticated: Boolean(user),
      isLoading: false,
      isBootstrapping: false,
    });
  }, []);

  const bootstrapSession = useCallback(async () => {
    clearLegacyAuthStorage();

    try {
      const session = await api.getSession();
      applySession(session.user);
    } catch {
      clearLegacyAuthStorage();
      applySession(null);
    }
  }, [applySession]);

  useEffect(() => {
    bootstrapSession();
  }, [bootstrapSession]);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearLegacyAuthStorage();
      applySession(null);
    };

    window.addEventListener('openstroid:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('openstroid:unauthorized', handleUnauthorized);
    };
  }, [applySession]);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setState((current) => ({ ...current, isLoading: true }));
    try {
      clearLegacyAuthStorage();
      const session = await api.login(credentials);
      applySession(session.user);
    } catch (error) {
      setState((current) => ({ ...current, isLoading: false }));
      throw error;
    }
  }, [applySession]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      clearLegacyAuthStorage();
      applySession(null);
    }
  }, [applySession]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

