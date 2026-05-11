import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { runMigrations } from '../../src/store/migrate.ts';
import { SyncRunsRepo } from '../../src/store/repos/sync-runs.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

const SyncRunRecordSchema = z
  .object({
    runId: z.string(),
    trigger: z.enum(['manual', 'scheduled']),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    durationSeconds: z.number().nullable(),
    summaryOutcome: z.enum(['success', 'partial', 'failed']).nullable(),
    scopeFilter: z.record(z.string(), z.unknown()).optional(),
    totals: z
      .object({
        discovered: z.number().int().nonnegative(),
        captured: z.number().int().nonnegative(),
        skippedUnchanged: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        withdrawn: z.number().int().nonnegative(),
        outOfScope: z.number().int().nonnegative(),
      })
      .strict(),
    failureRate: z.number().min(0).max(1).nullable(),
    manifestPath: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .strict();

describe('contract.sync-run', () => {
  it('SyncRunsRepo.recent rows project to sync-run.schema.json shape', () => {
    const d = new Database(':memory:');
    d.exec('PRAGMA foreign_keys = ON;');
    runMigrations(d, MIGRATIONS);
    const repo = new SyncRunsRepo(d);
    const created = repo.create({
      id: '01H',
      trigger: 'manual',
      scopeFilterJson: '{}',
      startedAt: '2026-05-08T00:00:00Z',
    });
    repo.finalize({
      id: created.id,
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
    const row = repo.recent(1)[0];
    if (!row) throw new Error('no row');
    const projected = {
      runId: row.id,
      trigger: row.trigger,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: row.ended_at ? 60 : null,
      summaryOutcome: row.summary_outcome,
      scopeFilter: JSON.parse(row.scope_filter_json),
      totals: {
        discovered: row.discovered_count,
        captured: row.captured_count,
        skippedUnchanged: row.skipped_unchanged_count,
        failed: row.failed_count,
        withdrawn: row.withdrawn_count,
        outOfScope: row.out_of_scope_count,
      },
      failureRate: 0,
      manifestPath: row.manifest_path,
      notes: row.notes,
    };
    const result = SyncRunRecordSchema.safeParse(projected);
    if (!result.success) throw new Error(JSON.stringify(result.error.issues));
    expect(result.success).toBe(true);
    d.close();
  });
});
