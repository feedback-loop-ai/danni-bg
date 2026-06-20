// Per-user self endpoints (token metering): GET /api/me/usage reports the signed-in user's own token
// usage + effective quota. Behind requireAuth (any tier) — no admin required.

import { Hono } from 'hono';
import type { TokenUsageRepo } from '../../../../src/store/repos/token-usage.ts';
import type { UsersRepo } from '../../../../src/store/repos/users.ts';
import type { SessionResolver } from '../auth/kratos-session.ts';
import { effectiveLimit, quotaView } from '../chat/quota.ts';
import { type AuthEnv, requireAuth } from '../middleware/require-auth.ts';

export function meRoutes(
  users: UsersRepo,
  tokenUsage: TokenUsageRepo,
  defaultTokenLimit: () => number | undefined,
  resolveSession?: SessionResolver,
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use('*', requireAuth(users, resolveSession));

  app.get('/usage', (c) => {
    const user = c.get('user');
    const { used, requests, lastUsedAt } = tokenUsage.usageForUser(user.id, user.usage_reset_at);
    const limit = effectiveLimit(user.token_limit, defaultTokenLimit());
    return c.json({ ...quotaView(used, limit), requests, lastUsedAt });
  });

  return app;
}
