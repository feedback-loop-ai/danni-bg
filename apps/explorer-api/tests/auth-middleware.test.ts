// Auth guards (spec 019) — hermetic: no live Kratos. requireAuth trusts the X-User-* headers
// Oathkeeper injects, so we drive it by setting those headers on the request (Constitution VI).

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { runMigrations } from '../../../src/store/migrate.ts';
import { UsersRepo } from '../../../src/store/repos/users.ts';
import type { SessionResolver } from '../src/auth/kratos-session.ts';
import { type AuthEnv, requireAdmin, requireAuth } from '../src/middleware/require-auth.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function setup() {
  const db = new Database(':memory:');
  runMigrations(db, join(ROOT, 'migrations'));
  const users = new UsersRepo(db);
  const app = new Hono<AuthEnv>();
  app.use('/me', requireAuth(users));
  app.get('/me', (c) => c.json(c.get('user')));
  app.use('/admin', requireAuth(users), requireAdmin);
  app.get('/admin', (c) => c.json({ ok: true }));
  return { db, users, app };
}

const authed = (over: Record<string, string> = {}) => ({
  'x-user-id': 'k1',
  'x-user-email': 'u@example.com',
  'x-user-verified': 'true',
  ...over,
});

describe('requireAuth / requireAdmin', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
    delete process.env.ADMIN_BOOTSTRAP_EMAILS;
  });

  it('401s when no identity headers are present', async () => {
    const res = await s.app.request('/me');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('401s on the Oathkeeper anonymous subject', async () => {
    const res = await s.app.request('/me', { headers: { 'x-user-id': 'anonymous' } });
    expect(res.status).toBe(401);
  });

  it('passes through, find-or-creates the user (role user), and is idempotent', async () => {
    const r1 = await s.app.request('/me', { headers: authed() });
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { role: string }).role).toBe('user');
    await s.app.request('/me', { headers: authed() });
    expect(s.users.listAll()).toHaveLength(1); // same identity → one row
  });

  it('403s a normal user on an admin route; 200 after promotion', async () => {
    const forbidden = await s.app.request('/admin', { headers: authed() });
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { error: { code: string } }).error.code).toBe('forbidden');

    s.users.setRoleByEmail('u@example.com', 'admin');
    const ok = await s.app.request('/admin', { headers: authed() });
    expect(ok.status).toBe(200);
  });

  it('auto-promotes a bootstrap email to admin on first login', async () => {
    process.env.ADMIN_BOOTSTRAP_EMAILS = 'boss@example.com, other@example.com';
    const res = await s.app.request('/admin', {
      headers: authed({ 'x-user-id': 'kboss', 'x-user-email': 'boss@example.com' }),
    });
    expect(res.status).toBe(200);
    expect(s.users.findByEmail('boss@example.com')?.role).toBe('admin');
  });
});

describe('requireAuth session-resolver fallback (single-port, no Oathkeeper)', () => {
  function appWith(resolver?: SessionResolver) {
    const db = new Database(':memory:');
    runMigrations(db, join(ROOT, 'migrations'));
    const users = new UsersRepo(db);
    const app = new Hono<AuthEnv>();
    app.use('/me', requireAuth(users, resolver));
    app.get('/me', (c) => c.json(c.get('user')));
    return { db, users, app };
  }

  it('resolves the session from the cookie when no X-User-* headers are present', async () => {
    const resolver: SessionResolver = async (cookie) =>
      cookie === 'ory_kratos_session=ok'
        ? { userId: 'k9', email: 'cookie@example.com', verified: true }
        : null;
    const { db, users, app } = appWith(resolver);
    const res = await app.request('/me', { headers: { cookie: 'ory_kratos_session=ok' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { email: string }).email).toBe('cookie@example.com');
    expect(users.findByKratosId('k9')?.role).toBe('user');
    db.close();
  });

  it('401s when neither headers nor the resolver yield an identity', async () => {
    const { db, app } = appWith(async () => null);
    expect((await app.request('/me')).status).toBe(401);
    db.close();
  });

  it('prefers Oathkeeper headers over the resolver (resolver not called)', async () => {
    let called = false;
    const resolver: SessionResolver = async () => {
      called = true;
      return null;
    };
    const { db, app } = appWith(resolver);
    const res = await app.request('/me', {
      headers: { 'x-user-id': 'kh', 'x-user-email': 'hdr@example.com', 'x-user-verified': 'true' },
    });
    expect(res.status).toBe(200);
    expect(called).toBe(false);
    db.close();
  });
});
