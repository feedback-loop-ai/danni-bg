// Session + tier state (spec 019). On mount (and after login) it calls Kratos `toSession()`; if a
// session exists it asks the backend `/api/auth/callback` to find-or-create the app user and report
// the tier (admin/user). Logout uses the Kratos browser logout flow.

import type { Session } from '@ory/client';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { kratos } from '../lib/kratos.ts';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'user';
  avatarUrl: string | null;
}

export interface AuthState {
  loading: boolean;
  session: Session | null;
  user: AuthUser | null;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await kratos.toSession();
      setSession(data);
      const res = await fetch('/api/auth/callback', { method: 'POST', credentials: 'include' });
      if (res.ok) {
        const body = (await res.json()) as { user: AuthUser };
        setUser(body.user);
      } else {
        setUser(null);
      }
    } catch {
      // No active session (401 from whoami) — anonymous.
      setSession(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      // Same-origin logout: run the flow via the /kratos proxy and submit the token ourselves rather
      // than navigating to Kratos's `logout_url` (which redirects to the configured return URL on a
      // different port). The session cookie is cleared via the proxied Set-Cookie; we then go home.
      const { data } = await kratos.createBrowserLogoutFlow();
      await kratos.updateLogoutFlow({ token: data.logout_token });
    } catch {
      // Already logged out / no session — fall through to the reset.
    }
    setSession(null);
    setUser(null);
    window.location.assign('/'); // hard reload re-runs whoami (now 401) → clean anonymous state
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AuthCtx.Provider
      value={{ loading, session, user, isAdmin: user?.role === 'admin', refresh, logout }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
