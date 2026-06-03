import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { NotificationsRepo } from '../../../../src/store/repos/notifications.ts';
import { SyncRunsRepo } from '../../../../src/store/repos/sync-runs.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  new SyncRunsRepo(d).create({ id: 'run-1', trigger: 'manual', scopeFilterJson: '{}' });
  return d;
}

describe('store.repos.notifications', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('insert + listByRun round trip', () => {
    const repo = new NotificationsRepo(database);
    repo.insert({
      runId: 'run-1',
      kind: 'run_failed',
      channel: 'stderr',
      payload: { failureRate: 0.5 },
      deliveredAt: '2026-05-08T00:00:00Z',
    });
    const rows = repo.listByRun('run-1');
    expect(rows.length).toBe(1);
    expect(rows[0]?.kind).toBe('run_failed');
    expect(JSON.parse(rows[0]?.payload_json ?? '{}')).toEqual({ failureRate: 0.5 });
  });

  it('falls back to nowIso for deliveredAt', () => {
    const repo = new NotificationsRepo(database);
    repo.insert({
      runId: 'run-1',
      kind: 'threshold_exceeded',
      channel: 'webhook:https://x',
      payload: {},
    });
    const row = repo.listByRun('run-1')[0];
    expect(row?.delivered_at).toBeDefined();
  });
});
