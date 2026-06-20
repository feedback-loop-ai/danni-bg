// Per-user token usage repo (token metering): recording, windowed totals, admin overview.

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { TokenUsageRepo } from '../../../../src/store/repos/token-usage.ts';
import { UsersRepo } from '../../../../src/store/repos/users.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

function seedUser(users: UsersRepo, kratosId: string, email: string) {
  return users.findOrCreateByKratosId({ kratosIdentityId: kratosId, email });
}

describe('TokenUsageRepo', () => {
  let db: Database;
  let usage: TokenUsageRepo;
  let users: UsersRepo;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, join(ROOT, 'migrations'));
    usage = new TokenUsageRepo(db);
    users = new UsersRepo(db);
  });
  afterEach(() => db.close());

  it('records usage and totals it (incl. input/output/cache breakdown) for a user', () => {
    const u = seedUser(users, 'k1', 'a@example.com');
    usage.record({ userId: u.id, inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 3, now: '2026-01-01T00:00:00Z' });
    usage.record({ userId: u.id, inputTokens: 20, outputTokens: 10, totalTokens: 30, cachedInputTokens: 7, now: '2026-01-02T00:00:00Z' });
    const got = usage.usageForUser(u.id, null);
    expect(got).toMatchObject({ used: 45, input: 30, output: 15, cached: 10, requests: 2, lastUsedAt: '2026-01-02T00:00:00Z' });
  });

  it('counts only usage at/after the reset window', () => {
    const u = seedUser(users, 'k1', 'a@example.com');
    usage.record({ userId: u.id, inputTokens: 0, outputTokens: 0, totalTokens: 100, now: '2026-01-01T00:00:00Z' });
    usage.record({ userId: u.id, inputTokens: 0, outputTokens: 0, totalTokens: 40, now: '2026-02-01T00:00:00Z' });
    expect(usage.usageForUser(u.id, '2026-01-15T00:00:00Z').used).toBe(40);
  });

  it('clamps negative/garbage token counts to 0', () => {
    const u = seedUser(users, 'k1', 'a@example.com');
    usage.record({ userId: u.id, inputTokens: -5, outputTokens: Number.NaN, totalTokens: -1 });
    expect(usage.usageForUser(u.id, null).used).toBe(0);
  });

  it('summaryByUser joins tier + per-user limit + windowed usage, sorted by usage desc', () => {
    const a = seedUser(users, 'k1', 'a@example.com');
    const b = seedUser(users, 'k2', 'b@example.com');
    users.setTokenLimit(b.id, 500);
    usage.record({ userId: a.id, inputTokens: 1, outputTokens: 1, totalTokens: 10, now: '2026-01-01T00:00:00Z' });
    usage.record({ userId: b.id, inputTokens: 1, outputTokens: 1, totalTokens: 99, now: '2026-01-01T00:00:00Z' });
    // A reset on b hides earlier usage from the total.
    users.resetUsage(b.id, '2026-06-01T00:00:00Z');
    const rows = usage.summaryByUser();
    expect(rows.map((r) => r.email)).toEqual(['a@example.com', 'b@example.com']); // a:10 used > b:0 after reset
    const bRow = rows.find((r) => r.email === 'b@example.com');
    expect(bRow).toMatchObject({ tokenLimit: 500, used: 0, requests: 0 });
    expect(rows.find((r) => r.email === 'a@example.com')).toMatchObject({ used: 10, requests: 1 });
  });
});
