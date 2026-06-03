import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { SyncRunsLockRepo } from '../../../../src/store/repos/sync-runs-lock.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  return d;
}

describe('store.repos.sync-runs-lock', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('starts unlocked', () => {
    const repo = new SyncRunsLockRepo(database);
    const state = repo.state();
    expect(state.is_locked).toBe(0);
    expect(state.held_by_run_id).toBeNull();
  });

  it('tryAcquire succeeds once and fails for second contender', () => {
    const repo = new SyncRunsLockRepo(database);
    expect(repo.tryAcquire('runA')).toBe(true);
    expect(repo.tryAcquire('runB')).toBe(false);
    expect(repo.state().held_by_run_id).toBe('runA');
  });

  it('release frees the lock for the holding run', () => {
    const repo = new SyncRunsLockRepo(database);
    repo.tryAcquire('runA');
    repo.release('runA');
    expect(repo.state().is_locked).toBe(0);
    expect(repo.tryAcquire('runB')).toBe(true);
  });

  it('release by non-holder is a no-op', () => {
    const repo = new SyncRunsLockRepo(database);
    repo.tryAcquire('runA');
    repo.release('runX');
    expect(repo.state().held_by_run_id).toBe('runA');
  });

  it('forceRelease unconditionally clears', () => {
    const repo = new SyncRunsLockRepo(database);
    repo.tryAcquire('runA');
    repo.forceRelease();
    const state = repo.state();
    expect(state.is_locked).toBe(0);
    expect(state.held_by_run_id).toBeNull();
  });

  it('state throws if seed row is missing', () => {
    database.exec('DELETE FROM sync_runs_lock');
    const repo = new SyncRunsLockRepo(database);
    expect(() => repo.state()).toThrow();
  });
});
