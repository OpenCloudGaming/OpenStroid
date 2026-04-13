import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { User, LoginCredentials } from '../types';
import * as api from '../api';
import { setTokens, clearTokens, hasStoredSession } from './storage';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isBootstrapping: boolean;
}

interface AuthContextValue extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    isBootstrapping: hasStoredSession(),
  });

  const bootstrapSession = useCallback(async () => {
    if (!hasStoredSession()) {
      setState((s) => ({ ...s, isBootstrapping: false }));
      return;
    }
    try {
      const user = await api.getCurrentUser();
      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        isBootstrapping: false,
      });
    } catch {
      clearTokens();
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        isBootstrapping: false,
      });
    }
  }, []);

  useEffect(() => {
    bootstrapSession();
  }, [bootstrapSession]);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setState((s) => ({ ...s, isLoading: true }));
    try {
      const tokens = await api.login(credentials);
      setTokens(tokens.access_token, tokens.refresh_token);
      const user = await api.getCurrentUser();
      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        isBootstrapping: false,
      });
    } catch (error) {
      setState((s) => ({ ...s, isLoading: false }));
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // proceed even if server logout fails
    } finally {
      clearTokens();
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        isBootstrapping: false,
      });
    }
  }, []);

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

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
