// Auth guards (spec 019). `requireAuth` enforces a valid session (401 otherwise), find-or-creates the
// app user row for the Kratos identity, and stashes it on the request context. `requireAdmin` (run
// after requireAuth) enforces the admin tier (403 otherwise). RBAC is application-layer off
// `users.role`; Oathkeeper/Kratos do not hold the role.

import type { MiddlewareHandler } from 'hono';
import type { UserRow, UsersRepo } from '../../../../src/store/repos/users.ts';
import type { SessionResolver } from '../auth/kratos-session.ts';
import { readAuth } from './auth.ts';

/** Hono environment for routes behind the auth guards: the resolved app user is on the context. */
export type AuthEnv = { Variables: { user: UserRow } };

// Optional convenience: emails auto-promoted to admin on FIRST login (existing rows keep their role).
// Otherwise promote with `danni admin grant <email>`. Read per call so it's configurable + testable.
function isBootstrapAdmin(email: string): boolean {
  const list = (process.env.ADMIN_BOOTSTRAP_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/**
 * Resolve the request identity from Oathkeeper's injected X-User-* headers (when fronted by
 * Oathkeeper) OR, when those are absent and a `resolveSession` is configured, by validating the
 * Kratos session cookie directly (single-port mode — no Oathkeeper needed). 401 if neither yields one.
 */
export function requireAuth(
  users: UsersRepo,
  resolveSession?: SessionResolver,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const header = readAuth(c);
    let identity: {
      userId: string;
      email: string;
      verified: boolean;
      displayName: string | null;
    } | null =
      header.isAuthenticated && header.userId && header.email
        ? {
            userId: header.userId,
            email: header.email,
            verified: header.verified,
            displayName: header.displayName,
          }
        : null;
    if (!identity && resolveSession) identity = await resolveSession(c.req.header('cookie'));
    if (!identity) {
      return c.json({ error: { code: 'unauthorized', message: 'authentication required' } }, 401);
    }
    const createRole = isBootstrapAdmin(identity.email) ? 'admin' : 'user';
    const user = users.findOrCreateByKratosId({
      kratosIdentityId: identity.userId,
      email: identity.email,
      emailVerified: identity.verified,
      displayName: identity.displayName,
      createRole,
    });
    c.set('user', user);
    await next();
    return undefined;
  };
}

/** Must run after requireAuth (reads the resolved user). */
export const requireAdmin: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    return c.json({ error: { code: 'forbidden', message: 'admin access required' } }, 403);
  }
  await next();
  return undefined;
};
