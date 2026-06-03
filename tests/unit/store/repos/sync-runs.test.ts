import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { SyncRunsRepo } from '../../../../src/store/repos/sync-runs.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  return d;
}

describe('store.repos.sync-runs', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('creates and finalizes a run', () => {
    const repo = new SyncRunsRepo(database);
    const created = repo.create({
      id: '01H0',
      trigger: 'manual',
      scopeFilterJson: '{}',
      startedAt: '2026-05-08T00:00:00Z',
    });
    expect(created.summary_outcome).toBeNull();
    const final = repo.finalize({
      id: '01H0',
      summaryOutcome: 'success',
      totals: {
        discovered: 1,
        captured: 1,
        skippedUnchanged: 0,
        failed: 0,
        withdrawn: 0,
        outOfScope: 0,
      },
      manifestPath: '/tmp/m.json',
      endedAt: '2026-05-08T00:01:00Z',
    });
    expect(final.summary_outcome).toBe('success');
    expect(final.captured_count).toBe(1);
  });

  it('appendNote concatenates notes', () => {
    const repo = new SyncRunsRepo(database);
    repo.create({ id: 'n1', trigger: 'manual', scopeFilterJson: '{}' });
    repo.appendNote('n1', 'first');
    repo.appendNote('n1', 'second');
    expect(repo.get('n1')?.notes).toBe('first\nsecond');
  });

  it('appendNote on non-existent run is a no-op', () => {
    const repo = new SyncRunsRepo(database);
    repo.appendNote('missing', 'noop');
    expect(repo.get('missing')).toBeNull();
  });

  it('recent returns runs ordered by started_at desc', () => {
    const repo = new SyncRunsRepo(database);
    repo.create({
      id: 'a',
      trigger: 'manual',
      scopeFilterJson: '{}',
      startedAt: '2026-05-01T00:00:00Z',
    });
    repo.create({
      id: 'b',
      trigger: 'manual',
      scopeFilterJson: '{}',
      startedAt: '2026-05-02T00:00:00Z',
    });
    expect(repo.recent(10).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('abandonStale finalizes ongoing runs as failed', () => {
    const repo = new SyncRunsRepo(database);
    repo.create({ id: 's1', trigger: 'manual', scopeFilterJson: '{}' });
    const stale = repo.abandonStale('process exit', '2099-01-01T00:00:00Z');
    expect(stale.length).toBe(1);
    const after = repo.get('s1');
    expect(after?.summary_outcome).toBe('failed');
    expect(after?.notes).toContain('abandoned: process exit');
  });
});
