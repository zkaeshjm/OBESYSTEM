import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setAccessToken } from '../api/client';
import type { Permissions, User } from '../api/types';

interface AuthState {
  user: User | null;
  permissions: Permissions | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .refresh()
      .then((response) => {
        if (!active) return;
        setAccessToken(response.data.accessToken);
        setUser(response.data.user);
        setPermissions(response.data.permissions);
      })
      .catch(() => {
        setAccessToken(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login(email, password);
    setAccessToken(response.data.accessToken);
    setUser(response.data.user);
    setPermissions(response.data.permissions);
    return response.data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
      setPermissions(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const response = await api.me();
    setUser(response.data.user);
    setPermissions(response.data.permissions);
  }, []);

  const value = useMemo(
    () => ({ user, permissions, loading, login, logout, refreshUser }),
    [user, permissions, loading, login, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
