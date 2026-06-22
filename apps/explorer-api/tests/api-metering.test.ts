// API metering + rate limits + request quota (spec 028) — hermetic. The public read API is free for
// anonymous callers and metered/limited/quota'd for API-key callers; the chat route is rate-limited.

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, type MiddlewareHandler } from 'hono';
import { runMigrations } from '../../../src/store/migrate.ts';
import { ApiKeyRepo } from '../../../src/store/repos/api-keys.ts';
import { ApiUsageRepo } from '../../../src/store/repos/api-usage.ts';
import { UsersRepo } from '../../../src/store/repos/users.ts';
import { chatMeter, dataApiGate } from '../src/middleware/api-metering.ts';
import { RateLimiter } from '../src/middleware/rate-limiter.ts';
import { requireAuth, requireScope } from '../src/middleware/require-auth.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function setup(over: Partial<{ rateData: number; rateChat: number; quotaData: number }> = {}) {
  const db = new Database(':memory:');
  runMigrations(db, join(ROOT, 'migrations'));
  const users = new UsersRepo(db);
  const apiKeys = new ApiKeyRepo(db);
  const apiUsage = new ApiUsageRepo(db);
  const owner = users.findOrCreateByKratosId({ kratosIdentityId: 'k1', email: 'u@example.com' });
  const limiter = new RateLimiter(() => 1_000_000);
  const cfg = {
    rateData: over.rateData ?? 1000,
    rateChat: over.rateChat ?? 1000,
    quotaData: over.quotaData ?? 1_000_000,
    quotaWindowSec: 86_400,
  };
  const deps = {
    usage: apiUsage,
    limiter,
    config: {
      rateData: () => cfg.rateData,
      rateChat: () => cfg.rateChat,
      quotaData: () => cfg.quotaData,
      quotaWindowSec: () => cfg.quotaWindowSec,
    },
  };
  const app = new Hono();
  app.use('/data', dataApiGate(apiKeys, deps));
  app.get('/data', (c) => c.json({ ok: true }));
  app.use(
    '/chat',
    requireAuth(users, undefined, apiKeys) as MiddlewareHandler,
    requireScope('chat') as MiddlewareHandler,
    chatMeter(deps) as MiddlewareHandler,
  );
  app.get('/chat', (c) => c.json({ ok: true }));
  return { db, users, apiKeys, apiUsage, owner, app };
}

const bearer = (key: string) => ({ headers: { authorization: `Bearer ${key}` } });

describe('API metering (spec 028)', () => {
  let s: ReturnType<typeof setup>;
  afterEach(() => s.db.close());

  it('anonymous read is free + unmetered; an API-key read is metered', async () => {
    s = setup();
    expect((await s.app.request('/data')).status).toBe(200);
    expect(s.apiUsage.countSince(s.owner.id, '2000-01-01T00:00:00.000Z')).toBe(0);

    const { plaintext } = s.apiKeys.create({ userId: s.owner.id, name: 'k' });
    expect((await s.app.request('/data', bearer(plaintext))).status).toBe(200);
    expect(s.apiUsage.countSince(s.owner.id, '2000-01-01T00:00:00.000Z', 'data')).toBe(1);
  });

  it('rate-limits an API-key caller with 429 + Retry-After', async () => {
    s = setup({ rateData: 1 });
    const { plaintext } = s.apiKeys.create({ userId: s.owner.id, name: 'k' });
    expect((await s.app.request('/data', bearer(plaintext))).status).toBe(200);
    const res = await s.app.request('/data', bearer(plaintext));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('enforces the data request quota with 429 quota_exceeded', async () => {
    s = setup({ quotaData: 2 });
    const { plaintext } = s.apiKeys.create({ userId: s.owner.id, name: 'k' });
    expect((await s.app.request('/data', bearer(plaintext))).status).toBe(200);
    expect((await s.app.request('/data', bearer(plaintext))).status).toBe(200);
    const res = await s.app.request('/data', bearer(plaintext));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('quota_exceeded');
  });

  it('a per-key quota override beats the plan default', async () => {
    s = setup({ quotaData: 1000 });
    const { plaintext, view } = s.apiKeys.create({ userId: s.owner.id, name: 'k' });
    s.db.query('UPDATE api_keys SET quota_limit = 1 WHERE id = ?').run(view.id);
    expect((await s.app.request('/data', bearer(plaintext))).status).toBe(200);
    expect((await s.app.request('/data', bearer(plaintext))).status).toBe(429);
  });

  it('rejects a revoked key and a key without read scope on the data API', async () => {
    s = setup();
    const revoked = s.apiKeys.create({ userId: s.owner.id, name: 'r' });
    s.apiKeys.revoke(revoked.view.id, s.owner.id);
    expect((await s.app.request('/data', bearer(revoked.plaintext))).status).toBe(401);

    const noRead = s.apiKeys.create({ userId: s.owner.id, name: 'chat-only', scopes: ['chat'] });
    const res = await s.app.request('/data', bearer(noRead.plaintext));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'insufficient_scope',
    );
  });

  it('meters + rate-limits the chat route', async () => {
    s = setup({ rateChat: 1 });
    const { plaintext } = s.apiKeys.create({ userId: s.owner.id, name: 'k' });
    expect((await s.app.request('/chat', bearer(plaintext))).status).toBe(200);
    expect(s.apiUsage.countSince(s.owner.id, '2000-01-01T00:00:00.000Z', 'chat')).toBe(1);
    expect((await s.app.request('/chat', bearer(plaintext))).status).toBe(429);
  });
});
