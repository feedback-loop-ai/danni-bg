// Auth guards (spec 019). `requireAuth` enforces a valid session (401 otherwise), find-or-creates the
// app user row for the Kratos identity, and stashes it on the request context. `requireAdmin` (run
// after requireAuth) enforces the admin tier (403 otherwise). RBAC is application-layer off
// `users.role`; Oathkeeper/Kratos do not hold the role.

import type { MiddlewareHandler } from 'hono';
import type { UserRow, UsersRepo } from '../../../../src/store/repos/users.ts';
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

export function requireAuth(users: UsersRepo): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const auth = readAuth(c);
    if (!auth.isAuthenticated || !auth.userId || !auth.email) {
      return c.json({ error: { code: 'unauthorized', message: 'authentication required' } }, 401);
    }
    const createRole = isBootstrapAdmin(auth.email) ? 'admin' : 'user';
    const user = users.findOrCreateByKratosId({
      kratosIdentityId: auth.userId,
      email: auth.email,
      emailVerified: auth.verified,
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
