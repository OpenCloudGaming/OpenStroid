import {
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { User } from '../types';
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

  const refreshSession = useCallback(async () => {
    setState((current) => ({ ...current, isLoading: true }));
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
    void refreshSession();
  }, [refreshSession]);

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
        refreshSession,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
