import type { Database } from 'bun:sqlite';
import { nowIso } from '../../lib/time.ts';

export interface SyncRunsLockRow {
  id: number;
  is_locked: number;
  held_by_run_id: string | null;
  acquired_at: string | null;
}

export class SyncRunsLockRepo {
  constructor(private readonly db: Database) {}

  state(): SyncRunsLockRow {
    const row = this.db
      .query<SyncRunsLockRow, []>('SELECT * FROM sync_runs_lock WHERE id = 1')
      .get();
    if (!row) throw new Error('sync_runs_lock row missing');
    return row;
  }

  /**
   * Atomically acquire the lock for `runId`. Returns true on success, false if held.
   */
  tryAcquire(runId: string, now: string = nowIso()): boolean {
    const result = this.db
      .query<unknown, [string, string, string]>(
        `UPDATE sync_runs_lock SET is_locked = 1, held_by_run_id = ?, acquired_at = ? WHERE id = 1 AND is_locked = 0 RETURNING ?`,
      )
      .all(runId, now, runId);
    return result.length > 0;
  }

  release(runId: string): void {
    this.db
      .query(
        `UPDATE sync_runs_lock SET is_locked = 0, held_by_run_id = NULL, acquired_at = NULL WHERE id = 1 AND held_by_run_id = ?`,
      )
      .run(runId);
  }

  forceRelease(): void {
    this.db
      .query(
        `UPDATE sync_runs_lock SET is_locked = 0, held_by_run_id = NULL, acquired_at = NULL WHERE id = 1`,
      )
      .run();
  }
}
