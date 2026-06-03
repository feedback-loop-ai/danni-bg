import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beginSyncRun } from '../../src/manifest/sync-run.ts';
import { openDb } from '../../src/store/db.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { SyncRunsLockRepo } from '../../src/store/repos/sync-runs-lock.ts';
import { SyncRunsRepo } from '../../src/store/repos/sync-runs.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('integration.resume-mid-run', () => {
  let db: Database;
  let storeRoot: string;
  beforeEach(() => {
    storeRoot = globalThis.__TEST_TMP_DIR__;
    db = openDb({ storeRoot, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
  });
  afterEach(() => {
    db.close();
  });

  it('a fresh sync after a partial run reaps the prior in-progress run and succeeds', () => {
    // Simulate an aborted process: begin + abort with partial progress.
    const first = beginSyncRun({
      db,
      storeRoot,
      trigger: 'manual',
      scopeFilter: {},
      onOverlap: 'skip',
    });
    first.recordEvent({ datasetId: 'd1', resourceId: 'r1', outcome: 'captured' });
    // Simulate process exit: do NOT call end(); just leave the row open.
    // Manually rewrite ended_at to NULL and re-acquire the lock to model "process crashed".
    db.exec(
      `UPDATE sync_runs SET ended_at = NULL, summary_outcome = NULL WHERE id = '${first.runId}'`,
    );
    new SyncRunsLockRepo(db).tryAcquire(first.runId);

    // New process starts a sync — the reaper should mark prior run as failed/abandoned.
    const second = beginSyncRun({
      db,
      storeRoot,
      trigger: 'manual',
      scopeFilter: {},
      onOverlap: 'skip',
    });
    expect(second.runId).not.toBe(first.runId);

    const prior = new SyncRunsRepo(db).get(first.runId);
    expect(prior?.summary_outcome).toBe('failed');
    expect(prior?.notes).toContain('abandoned');

    second.end({
      summaryOutcome: 'success',
      totals: {
        discovered: 0,
        captured: 0,
        skippedUnchanged: 0,
        failed: 0,
        withdrawn: 0,
        outOfScope: 0,
      },
      datasetEntries: [],
    });
  });
});
