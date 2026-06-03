import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../config/loader.ts';
import { diffSeconds, nowIso } from '../lib/time.ts';
import { openDb } from '../store/db.ts';
import { SyncRunsLockRepo } from '../store/repos/sync-runs-lock.ts';
import { type SyncRunRow, SyncRunsRepo } from '../store/repos/sync-runs.ts';

interface SyncRunJsonView {
  runId: string;
  trigger: 'manual' | 'scheduled';
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  summaryOutcome: 'success' | 'partial' | 'failed' | null;
  scopeFilter: unknown;
  totals: {
    discovered: number;
    captured: number;
    skippedUnchanged: number;
    failed: number;
    withdrawn: number;
    outOfScope: number;
  };
  failureRate: number | null;
  manifestPath: string | null;
  notes: string | null;
}

function toJson(row: SyncRunRow): SyncRunJsonView {
  const duration = row.ended_at ? diffSeconds(row.ended_at, row.started_at) : null;
  const denom = Math.max(row.discovered_count, 1);
  return {
    runId: row.id,
    trigger: row.trigger,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: duration,
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
    failureRate: row.discovered_count > 0 ? row.failed_count / denom : null,
    manifestPath: row.manifest_path,
    notes: row.notes,
  };
}

export interface StatusFlags {
  limit?: number;
  json?: boolean;
}

export function parseFlags(args: string[]): StatusFlags {
  const flags: StatusFlags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') flags.json = true;
    else if (a === '--limit') {
      const v = Number.parseInt(args[i + 1] ?? '', 10);
      if (!Number.isFinite(v) || v < 1 || v > 100) {
        throw new Error('--limit must be an integer between 1 and 100');
      }
      flags.limit = v;
      i++;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write('danni status [--limit <n>] [--json]\n');
      throw new Error('__HELP__');
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return flags;
}

export async function run(args: string[]): Promise<number> {
  let flags: StatusFlags;
  try {
    flags = parseFlags(args);
  } catch (err) {
    if (err instanceof Error && err.message === '__HELP__') return 0;
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const config = loadConfig();
  const storeRoot = resolve(process.cwd(), config.store.root);
  if (!existsSync(join(storeRoot, 'danni.sqlite'))) {
    process.stderr.write(`no danni.sqlite at ${storeRoot}. Run 'bun run db:migrate' first.\n`);
    return 4;
  }
  const db = openDb({ storeRoot, loadVec: false });
  try {
    const runs = new SyncRunsRepo(db).recent(flags.limit ?? 10);
    const lock = new SyncRunsLockRepo(db).state();

    if (flags.json) {
      process.stdout.write(`${JSON.stringify(runs.map(toJson), null, 2)}\n`);
      return 0;
    }

    const lastSuccess = runs.find((r) => r.summary_outcome === 'success');
    process.stdout.write(`storeRoot: ${storeRoot}\n`);
    process.stdout.write(`db: ${join(storeRoot, 'danni.sqlite')}\n`);
    process.stdout.write(`now: ${nowIso()}\n`);
    process.stdout.write(
      `lastSuccessfulSync: ${lastSuccess ? (lastSuccess.ended_at ?? lastSuccess.started_at) : '(none)'}\n`,
    );
    process.stdout.write(
      `lockHeldBy: ${lock.is_locked ? `${lock.held_by_run_id ?? 'unknown'} (acquired ${lock.acquired_at})` : 'none'}\n`,
    );
    process.stdout.write(`embedder: ${config.enrichment.embedder.provider}\n`);
    process.stdout.write(`translator: ${config.enrichment.translator.provider}\n`);
    process.stdout.write('recentRuns:\n');
    for (const row of runs) {
      const duration = row.ended_at
        ? `${diffSeconds(row.ended_at, row.started_at).toFixed(1)}s`
        : '(in-progress)';
      process.stdout.write(
        `  ${row.id}  ${row.started_at}  ${row.summary_outcome ?? 'running'}  d=${row.discovered_count} c=${row.captured_count} s=${row.skipped_unchanged_count} f=${row.failed_count}  ${duration}\n`,
      );
    }

    const robotsCachePath = join(storeRoot, 'robots-cache.json');
    if (existsSync(robotsCachePath)) {
      const age = (Date.now() - statSync(robotsCachePath).mtimeMs) / 1000;
      process.stdout.write(`robotsCacheAgeSeconds: ${age.toFixed(0)}\n`);
    }
    return 0;
  } finally {
    db.close();
  }
}
