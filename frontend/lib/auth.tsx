'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, clearTokens, storeTokens } from './api';

export interface Membership {
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'REVIEWER' | 'VIEWER';
  workspace: {
    id: string; name: string; slug: string;
    industry: string | null; plan: string; storageUsedBytes: bigint | number;
  };
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerifiedAt: string | null;
  onboardingStep: number;
  createdAt: string;
  memberships: Membership[];
  _count?: { notifications: number };
}

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string, keepSignedIn: boolean) => Promise<User>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ user: User }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [reload]);

  const signIn = useCallback(async (email: string, password: string, keepSignedIn: boolean) => {
    const data = await api<{ user: User; accessToken: string; refreshToken: string }>(
      '/api/auth/signin',
      { method: 'POST', body: { email, password, keepSignedIn } },
    );
    storeTokens(data);
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/api/auth/signout', { method: 'POST' });
    } catch {}
    clearTokens();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut, reload, setUser }),
    [user, loading, signIn, signOut, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function roleAtLeast(role: string, min: string): boolean {
  const rank: Record<string, number> = { VIEWER: 1, REVIEWER: 2, EDITOR: 3, ADMIN: 4, OWNER: 5 };
  return (rank[role] ?? 0) >= (rank[min] ?? 0);
}
