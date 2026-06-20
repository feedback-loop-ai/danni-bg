// Per-user self endpoints (token metering): GET /api/me/usage reports the signed-in user's own token
// usage + effective quota (with cache hits discounted to the configured weight). Behind requireAuth
// (any tier) — no admin required.

import { Hono } from 'hono';
import { z } from 'zod';
import type { TokenUsageRepo } from '../../../../src/store/repos/token-usage.ts';
import type { UsersRepo } from '../../../../src/store/repos/users.ts';
import type { SessionResolver } from '../auth/kratos-session.ts';
import { billableTokens, effectiveLimit, quotaView } from '../chat/quota.ts';
import type { PersistentSessionStore } from '../chat/sessions-repo.ts';
import { type AuthEnv, requireAuth } from '../middleware/require-auth.ts';

// Profile picture: a small data: image URL (the client resizes first). Cap the size so a base64 blob
// can't bloat the row / the session callback payload.
const MAX_AVATAR_CHARS = 600_000;
const avatarBody = z.object({
  avatarUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg|webp);base64,/, 'must be a data:image URL')
    .max(MAX_AVATAR_CHARS)
    .nullable(),
});

export interface MeRoutesOpts {
  defaultTokenLimit: () => number | undefined;
  cacheWeight: () => number | undefined;
  sessionResolver?: SessionResolver | undefined;
  chatSessions?: PersistentSessionStore | undefined;
}

export function meRoutes(
  users: UsersRepo,
  tokenUsage: TokenUsageRepo,
  opts: MeRoutesOpts,
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use('*', requireAuth(users, opts.sessionResolver));

  app.get('/usage', (c) => {
    const user = c.get('user');
    const u = tokenUsage.usageForUser(user.id, user.usage_reset_at);
    const limit = effectiveLimit(user.token_limit, opts.defaultTokenLimit());
    // `used` is the billable total (cache hits discounted); the breakdown stays raw.
    return c.json({
      ...quotaView(billableTokens(u.used, u.cached, opts.cacheWeight()), limit),
      input: u.input,
      output: u.output,
      cached: u.cached,
      requests: u.requests,
      lastUsedAt: u.lastUsedAt,
    });
  });

  // Set or clear (null) the caller's profile picture.
  app.put('/avatar', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'bad_request', message: 'invalid JSON body' } }, 400);
    }
    const parsed = avatarBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'bad_request', message: 'invalid avatar' } }, 400);
    }
    users.setAvatar(c.get('user').id, parsed.data.avatarUrl);
    return c.json({ avatarUrl: parsed.data.avatarUrl });
  });

  // Resumable chat history (only when a persistent store is wired). All scoped to the caller.
  const sessions = opts.chatSessions;
  if (sessions) {
    app.get('/sessions', (c) => c.json({ sessions: sessions.listForUser(c.get('user').id) }));

    app.get('/sessions/:id', (c) => {
      const conv = sessions.getForUser(c.req.param('id'), c.get('user').id);
      if (!conv) return c.json({ error: { code: 'not_found', message: 'no such session' } }, 404);
      return c.json(conv);
    });

    app.delete('/sessions/:id', (c) => {
      if (!sessions.deleteForUser(c.req.param('id'), c.get('user').id)) {
        return c.json({ error: { code: 'not_found', message: 'no such session' } }, 404);
      }
      return c.json({ ok: true });
    });
  }

  return app;
}
