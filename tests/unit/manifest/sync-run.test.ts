import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LockContentionError,
  beginSyncRun,
  failureRate,
  reapAbandonedRuns,
} from '../../../src/manifest/sync-run.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { SyncRunsLockRepo } from '../../../src/store/repos/sync-runs-lock.ts';
import { SyncRunsRepo } from '../../../src/store/repos/sync-runs.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  return d;
}

const ZERO_TOTALS = {
  discovered: 0,
  captured: 0,
  skippedUnchanged: 0,
  failed: 0,
  withdrawn: 0,
  outOfScope: 0,
};

describe('manifest.sync-run lifecycle', () => {
  let database: Database;
  let storeRoot: string;
  beforeEach(() => {
    database = db();
    storeRoot = globalThis.__TEST_TMP_DIR__;
  });
  afterEach(() => {
    database.close();
  });

  it('begin acquires the lock and end writes a manifest + finalizes the row', () => {
    const handle = beginSyncRun({
      db: database,
      storeRoot,
      trigger: 'manual',
      scopeFilter: {},
      onOverlap: 'skip',
    });
    handle.recordEvent({ datasetId: 'd1', outcome: 'discovered' });
    const result = handle.end({
      summaryOutcome: 'success',
      totals: { ...ZERO_TOTALS, discovered: 1 },
      datasetEntries: [],
    });
    expect(existsSync(result.manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf-8'));
    expect(manifest.summaryOutcome).toBe('success');
    const row = new SyncRunsRepo(database).get(handle.runId);
    expect(row?.summary_outcome).toBe('success');
    expect(new SyncRunsLockRepo(database).state().is_locked).toBe(0);
  });

  it('append-once invariant: end twice throws', () => {
    const handle = beginSyncRun({
      db: database,
      storeRoot,
      trigger: 'manual',
      scopeFilter: {},
      onOverlap: 'skip',
    });
    handle.end({ summaryOutcome: 'success', totals: ZERO_TOTALS, datasetEntries: [] });
    expect(() =>
      handle.end({ summaryOutcome: 'success', totals: ZERO_TOTALS, datasetEntries: [] }),
    ).toThrow();
  });

  it('contention with onOverlap=skip throws LockContentionError', () => {
    // Hold the lock without a corresponding sync_runs row so the reaper can't release it.
    new SyncRunsLockRepo(database).tryAcquire('external-holder');
    expect(() =>
      beginSyncRun({
        db: database,
        storeRoot,
        trigger: 'manual',
        scopeFilter: {},
        onOverlap: 'skip',
      }),
    ).toThrow(LockContentionError);
  });

  it('contention with onOverlap=queue still surfaces LockContentionError to the caller', () => {
    new SyncRunsLockRepo(database).tryAcquire('external-holder');
    expect(() =>
      beginSyncRun({
        db: database,
        storeRoot,
        trigger: 'manual',
        scopeFilter: {},
        onOverlap: 'queue',
      }),
    ).toThrow(LockContentionError);
  });

  it('abort marks the run failed and releases the lock', () => {
    const handle = beginSyncRun({
      db: database,
      storeRoot,
      trigger: 'manual',
      scopeFilter: {},
      onOverlap: 'skip',
    });
    handle.abort('boom');
    expect(new SyncRunsLockRepo(database).state().is_locked).toBe(0);
    const row = new SyncRunsRepo(database).get(handle.runId);
    expect(row?.summary_outcome).toBe('failed');
    expect(row?.notes).toContain('aborted: boom');
  });

  it('abort after end is a no-op', () => {
    const handle = beginSyncRun({
      db: database,
      storeRoot,
      trigger: 'manual',
      scopeFilter: {},
      onOverlap: 'skip',
    });
    handle.end({ summaryOutcome: 'success', totals: ZERO_TOTALS, datasetEntries: [] });
    handle.abort('too-late'); // should not throw
    const row = new SyncRunsRepo(database).get(handle.runId);
    expect(row?.summary_outcome).toBe('success');
  });

  it('reapAbandonedRuns marks stale runs failed and force-releases lock', () => {
    new SyncRunsRepo(database).create({
      id: 'stale',
      trigger: 'manual',
      scopeFilterJson: '{}',
    });
    new SyncRunsLockRepo(database).tryAcquire('stale');
    const ids = reapAbandonedRuns(database);
    expect(ids).toContain('stale');
    expect(new SyncRunsLockRepo(database).state().is_locked).toBe(0);
    const row = new SyncRunsRepo(database).get('stale');
    expect(row?.summary_outcome).toBe('failed');
  });

  it('reapAbandonedRuns is a no-op when no runs are stale', () => {
    const ids = reapAbandonedRuns(database);
    expect(ids).toEqual([]);
  });

  it('failureRate handles zero discovered', () => {
    expect(failureRate({ ...ZERO_TOTALS })).toBe(0);
    expect(failureRate({ ...ZERO_TOTALS, discovered: 4, failed: 1 })).toBeCloseTo(0.25);
  });

  it('LockContentionError exposes heldByRunId', () => {
    const err = new LockContentionError('held-by');
    expect(err.heldByRunId).toBe('held-by');
    expect(err.name).toBe('LockContentionError');
  });

  it('LockContentionError handles null held_by', () => {
    const err = new LockContentionError(null);
    expect(err.message).toContain('unknown run');
  });

  it('end carries notes through to manifest', () => {
    const handle = beginSyncRun({
      db: database,
      storeRoot,
      trigger: 'manual',
      scopeFilter: {},
      onOverlap: 'skip',
    });
    const r = handle.end({
      summaryOutcome: 'partial',
      totals: ZERO_TOTALS,
      datasetEntries: [],
      notes: 'partial-with-warnings',
    });
    const manifest = JSON.parse(readFileSync(r.manifestPath, 'utf-8'));
    expect(manifest.notes).toBe('partial-with-warnings');
  });
});
