// Reads the identity Oathkeeper injects after validating the Kratos session (spec 019). The backend
// trusts ONLY these headers — it never calls /sessions/whoami in-process — so unit tests drive auth
// by simply setting the headers (no live Kratos, Constitution VI). Gated traffic reaches Hono only
// via Oathkeeper, so the trust boundary holds.

import type { Context } from 'hono';

export interface AuthIdentity {
  userId: string | null; // Kratos identity id (X-User-ID subject)
  email: string | null;
  displayName: string | null;
  verified: boolean;
  sessionId: string | null;
  isAuthenticated: boolean;
}

export function readAuth(c: Context): AuthIdentity {
  const userId = c.req.header('x-user-id') ?? null;
  const email = c.req.header('x-user-email') ?? null;
  const displayName = c.req.header('x-user-name') ?? null;
  const sessionId = c.req.header('x-session-id') ?? null;
  const verified = c.req.header('x-user-verified') === 'true';
  // Oathkeeper's anonymous authenticator sets the subject to "anonymous"; treat that (and a missing
  // header) as unauthenticated.
  const isAuthenticated = userId !== null && userId !== '' && userId !== 'anonymous';
  return { userId, email, displayName, verified, sessionId, isAuthenticated };
}
