// Token metering routes — hermetic via createApp + injected identity headers (Constitution VI):
// admin per-user usage/quota admin, the per-user self view, and the chat quota gate (429).

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Crosswalk } from '../../../packages/geo-boundaries/src/crosswalk.ts';
import { loadCrosswalk } from '../../../packages/geo-boundaries/src/load.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { PlatformSettingsRepo } from '../../../src/store/repos/platform-settings.ts';
import { TokenUsageRepo } from '../../../src/store/repos/token-usage.ts';
import { UsersRepo } from '../../../src/store/repos/users.ts';
import { TOGGLES_SETTING_KEY } from '../src/admin/settings-schema.ts';
import { type AppContext, createApp } from '../src/app.ts';
import type { ReadBridge } from '../src/read-bridge.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function setup() {
  const db = new Database(':memory:');
  runMigrations(db, join(ROOT, 'migrations'));
  const users = new UsersRepo(db);
  const tokenUsage = new TokenUsageRepo(db);
  const settings = new PlatformSettingsRepo(db);
  const ctx: AppContext = {
    bridge: {} as ReadBridge,
    crosswalk: new Crosswalk(loadCrosswalk()),
    health: () => ({ lastSyncedAt: null, isStale: true, defaultProvider: 'absent' }),
    users,
    tokenUsage,
    settings,
  };
  const admin = users.findOrCreateByKratosId({
    kratosIdentityId: 'admin-k',
    email: 'admin@example.com',
  });
  users.setRoleByEmail('admin@example.com', 'admin');
  const user = users.findOrCreateByKratosId({
    kratosIdentityId: 'user-k',
    email: 'user@example.com',
  });
  return { db, users, tokenUsage, settings, admin, user, app: createApp(ctx) };
}

const ADMIN = {
  'content-type': 'application/json',
  'x-user-id': 'admin-k',
  'x-user-email': 'admin@example.com',
};
const USER = {
  'content-type': 'application/json',
  'x-user-id': 'user-k',
  'x-user-email': 'user@example.com',
};

describe('GET /api/admin/usage', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => s.db.close());

  it('returns per-user usage with the effective limit (admin only)', async () => {
    s.users.setTokenLimit(s.user.id, 1000);
    s.tokenUsage.record({
      userId: s.user.id,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    const res = await s.app.request('/api/admin/usage', { headers: ADMIN });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      defaultLimit: number;
      users: {
        email: string;
        used: number;
        limit: number;
        remaining: number;
        exceeded: boolean;
        tokenLimit: number | null;
      }[];
    };
    expect(body.defaultLimit).toBe(0);
    const row = body.users.find((u) => u.email === 'user@example.com');
    expect(row).toMatchObject({
      used: 150,
      limit: 1000,
      remaining: 850,
      exceeded: false,
      tokenLimit: 1000,
    });
  });

  it('403 for a normal user, 401 for anon', async () => {
    expect((await s.app.request('/api/admin/usage', { headers: USER })).status).toBe(403);
    expect((await s.app.request('/api/admin/usage')).status).toBe(401);
  });
});

describe('admin user-quota mutations', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => s.db.close());

  const put = (id: string, body: unknown) =>
    s.app.request(`/api/admin/users/${id}/limit`, {
      method: 'PUT',
      headers: ADMIN,
      body: JSON.stringify(body),
    });

  it('PUT sets and clears a per-user limit', async () => {
    expect((await put(s.user.id, { limit: 500 })).status).toBe(200);
    expect(s.users.get(s.user.id)?.token_limit).toBe(500);
    expect((await put(s.user.id, { limit: null })).status).toBe(200);
    expect(s.users.get(s.user.id)?.token_limit).toBeNull();
  });

  it('PUT rejects a bad body (400) and a missing user (404)', async () => {
    expect((await put(s.user.id, { limit: 'lots' })).status).toBe(400);
    expect((await put(s.user.id, 'nope')).status).toBe(400);
    expect((await put('missing', { limit: 5 })).status).toBe(404);
  });

  it('POST reset zeroes the counted usage and 404s a missing user', async () => {
    // Recorded before the reset instant, so the new window excludes it.
    s.tokenUsage.record({
      userId: s.user.id,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 999,
      now: '2020-01-01T00:00:00Z',
    });
    expect(
      (
        await s.app.request(`/api/admin/users/${s.user.id}/reset`, {
          method: 'POST',
          headers: ADMIN,
        })
      ).status,
    ).toBe(200);
    expect(
      s.tokenUsage.usageForUser(s.user.id, s.users.get(s.user.id)?.usage_reset_at ?? null).used,
    ).toBe(0);
    expect(
      (await s.app.request('/api/admin/users/missing/reset', { method: 'POST', headers: ADMIN }))
        .status,
    ).toBe(404);
  });
});

describe('GET /api/me/usage', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => s.db.close());

  it("reports the caller's own usage against the platform default limit", async () => {
    s.settings.set(TOGGLES_SETTING_KEY, { defaultTokenLimit: 100 }, 'test');
    s.tokenUsage.record({ userId: s.user.id, inputTokens: 10, outputTokens: 20, totalTokens: 30 });
    const res = await s.app.request('/api/me/usage', { headers: USER });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      used: 30,
      limit: 100,
      remaining: 70,
      exceeded: false,
      requests: 1,
    });
  });
});

describe('POST /api/chat quota gate', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => s.db.close());

  it('429s a user who is over their quota, before any model work', async () => {
    s.users.setTokenLimit(s.user.id, 50);
    s.tokenUsage.record({ userId: s.user.id, inputTokens: 0, outputTokens: 0, totalTokens: 60 });
    const res = await s.app.request('/api/chat', {
      method: 'POST',
      headers: USER,
      body: JSON.stringify({
        message: 'hi',
        provider: { kind: 'openai-compatible', model: 'm', apiKey: 'x' },
      }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('quota_exceeded');
  });

  it('allows a user under quota to proceed past the gate', async () => {
    s.users.setTokenLimit(s.user.id, 1000);
    s.tokenUsage.record({ userId: s.user.id, inputTokens: 0, outputTokens: 0, totalTokens: 10 });
    // Under quota → not 429 (it proceeds to SSE; provider misconfig surfaces inside the stream, not here).
    const res = await s.app.request('/api/chat', {
      method: 'POST',
      headers: USER,
      body: JSON.stringify({
        message: 'hi',
        provider: { kind: 'openai-compatible', model: 'm', apiKey: 'x' },
      }),
    });
    expect(res.status).not.toBe(429);
  });
});
