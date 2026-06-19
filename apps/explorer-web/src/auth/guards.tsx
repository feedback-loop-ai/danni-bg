// Route guards (spec 019). RequireAuth → /auth/login when anonymous; RequireAdmin → home for non-admins.

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext.tsx';

function Loading() {
  return <p className="mt-16 text-center text-sm text-muted-foreground">Зареждане…</p>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();
  if (loading) return <Loading />;
  return user ? <>{children}</> : <Navigate to="/auth/login" replace />;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { loading, isAdmin } = useAuth();
  if (loading) return <Loading />;
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}
