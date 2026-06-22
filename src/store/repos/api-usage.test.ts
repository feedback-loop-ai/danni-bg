import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../migrate.ts';
import { ApiUsageRepo } from './api-usage.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('ApiUsageRepo', () => {
  let db: Database;
  let repo: ApiUsageRepo;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, join(ROOT, 'migrations'));
    repo = new ApiUsageRepo(db);
  });
  afterEach(() => db.close());

  it('records requests and counts them by principal + route class within a window', () => {
    const now = '2026-06-22T12:00:00.000Z';
    repo.record({ principalKind: 'apiKey', principalId: 'u1', keyId: 'k1', routeClass: 'data', now });
    repo.record({ principalKind: 'apiKey', principalId: 'u1', keyId: 'k1', routeClass: 'data', now });
    repo.record({ principalKind: 'user', principalId: 'u1', routeClass: 'chat', now });
    repo.record({ principalKind: 'apiKey', principalId: 'u2', keyId: 'k9', routeClass: 'data', now });

    const since = '2026-06-22T00:00:00.000Z';
    expect(repo.countSince('u1', since)).toBe(3);
    expect(repo.countSince('u1', since, 'data')).toBe(2);
    expect(repo.countSince('u1', since, 'chat')).toBe(1);
    // a window that starts after the events sees nothing
    expect(repo.countSince('u1', '2026-06-23T00:00:00.000Z')).toBe(0);
  });

  it('summarises a user (total/data/chat + per-key) and all principals', () => {
    const now = '2026-06-22T12:00:00.000Z';
    repo.record({ principalKind: 'apiKey', principalId: 'u1', keyId: 'k1', routeClass: 'data', now });
    repo.record({ principalKind: 'apiKey', principalId: 'u1', keyId: 'k2', routeClass: 'data', now });
    repo.record({ principalKind: 'user', principalId: 'u1', routeClass: 'chat', now });
    repo.record({ principalKind: 'apiKey', principalId: 'u2', keyId: 'k9', routeClass: 'data', now });

    const since = '2026-06-22T00:00:00.000Z';
    const u1 = repo.summaryForUser('u1', since);
    expect({ total: u1.total, data: u1.data, chat: u1.chat }).toEqual({ total: 3, data: 2, chat: 1 });
    expect(u1.byKey.sort((a, b) => a.keyId.localeCompare(b.keyId))).toEqual([
      { keyId: 'k1', count: 1 },
      { keyId: 'k2', count: 1 },
    ]);

    const all = repo.summaryAll(since);
    expect(all.find((r) => r.principalId === 'u1')).toMatchObject({ total: 3, data: 2, chat: 1 });
    expect(all.find((r) => r.principalId === 'u2')).toMatchObject({ total: 1, data: 1, chat: 0 });
  });
});
