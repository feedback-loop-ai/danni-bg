import type { Database } from 'bun:sqlite';
import { nowIso } from '../../lib/time.ts';

export type SummaryOutcome = 'success' | 'partial' | 'failed';
export type RunTrigger = 'manual' | 'scheduled';

export interface SyncRunRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  trigger: RunTrigger;
  scope_filter_json: string;
  summary_outcome: SummaryOutcome | null;
  discovered_count: number;
  captured_count: number;
  skipped_unchanged_count: number;
  failed_count: number;
  withdrawn_count: number;
  out_of_scope_count: number;
  manifest_path: string | null;
  notes: string | null;
}

export interface CreateSyncRunInput {
  id: string;
  trigger: RunTrigger;
  scopeFilterJson: string;
  startedAt?: string;
}

export interface SyncRunTotals {
  discovered: number;
  captured: number;
  skippedUnchanged: number;
  failed: number;
  withdrawn: number;
  outOfScope: number;
}

export interface FinalizeSyncRunInput {
  id: string;
  endedAt?: string;
  summaryOutcome: SummaryOutcome;
  totals: SyncRunTotals;
  manifestPath: string | null;
  notes?: string | null;
}

export class SyncRunsRepo {
  constructor(private readonly db: Database) {}

  create(input: CreateSyncRunInput): SyncRunRow {
    const started = input.startedAt ?? nowIso();
    this.db
      .query(
        `INSERT INTO sync_runs (id, started_at, trigger, scope_filter_json) VALUES (?, ?, ?, ?)`,
      )
      .run(input.id, started, input.trigger, input.scopeFilterJson);
    return this.get(input.id) as SyncRunRow;
  }

  finalize(input: FinalizeSyncRunInput): SyncRunRow {
    const ended = input.endedAt ?? nowIso();
    this.db
      .query(
        `UPDATE sync_runs SET ended_at = ?, summary_outcome = ?, discovered_count = ?, captured_count = ?, skipped_unchanged_count = ?, failed_count = ?, withdrawn_count = ?, out_of_scope_count = ?, manifest_path = ?, notes = ? WHERE id = ?`,
      )
      .run(
        ended,
        input.summaryOutcome,
        input.totals.discovered,
        input.totals.captured,
        input.totals.skippedUnchanged,
        input.totals.failed,
        input.totals.withdrawn,
        input.totals.outOfScope,
        input.manifestPath,
        input.notes ?? null,
        input.id,
      );
    return this.get(input.id) as SyncRunRow;
  }

  appendNote(id: string, note: string): void {
    const row = this.get(id);
    if (!row) return;
    const merged = row.notes ? `${row.notes}\n${note}` : note;
    this.db.query('UPDATE sync_runs SET notes = ? WHERE id = ?').run(merged, id);
  }

  get(id: string): SyncRunRow | null {
    return this.db.query<SyncRunRow, [string]>('SELECT * FROM sync_runs WHERE id = ?').get(id) ?? null;
  }

  recent(limit: number): SyncRunRow[] {
    return this.db
      .query<SyncRunRow, [number]>(
        'SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?',
      )
      .all(limit);
  }

  abandonStale(reason: string, now: string = nowIso()): SyncRunRow[] {
    const stale = this.db
      .query<SyncRunRow, []>(
        "SELECT * FROM sync_runs WHERE ended_at IS NULL ORDER BY started_at",
      )
      .all();
    for (const row of stale) {
      this.db
        .query(
          `UPDATE sync_runs SET ended_at = ?, summary_outcome = 'failed', notes = COALESCE(notes || '\n', '') || ? WHERE id = ?`,
        )
        .run(now, `abandoned: ${reason}`, row.id);
    }
    return stale;
  }
}
