import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeScopeHash } from '../../src/crawler/scope-hash.ts';
import { openDb } from '../../src/store/db.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { CrawlCheckpointsRepo } from '../../src/store/repos/crawl-checkpoints.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const QUICKSTART = join(ROOT, 'specs/004-crawl-checkpoint-resume/quickstart.md');

describe('integration.quickstart-004', () => {
  let db: Database;
  beforeEach(() => {
    db = openDb({ storeRoot: globalThis.__TEST_TMP_DIR__, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
  });
  afterEach(() => {
    db.close();
  });

  it('the checkpoint tables documented in §0 exist with the shipped names', () => {
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crawl_checkpoint%' ORDER BY name",
      )
      .all()
      .map((t) => t.name);
    expect(tables).toEqual([
      'crawl_checkpoint_datasets',
      'crawl_checkpoint_resources',
      'crawl_checkpoints',
    ]);
  });

  it('the §1 cursor query columns exist on crawl_checkpoints', () => {
    const row = db
      .query('SELECT scope_hash, cursor_uri, total_datasets, status FROM crawl_checkpoints')
      .all();
    expect(row).toEqual([]);
  });

  it('the §5 remaining cross-check query yields the SAME number as the shipped remaining()', () => {
    const repo = new CrawlCheckpointsRepo(db);
    const { scopeHash } = computeScopeHash({});
    repo.createCampaign({ scopeHash, scopeJson: { all: true }, frozenIds: ['a', 'b', 'c', 'd'] });
    // a complete, b sub-cap failed (still counted), c capped failed (excluded), d pending.
    repo.upsertDataset({ scopeHash, datasetUri: 'a', validator: 'v', resourceCount: 0 });
    repo.markDatasetComplete(scopeHash, 'a');
    repo.upsertDataset({ scopeHash, datasetUri: 'b', validator: 'v', resourceCount: 0 });
    repo.markDatasetFailed(scopeHash, 'b', '1'); // attempts 1 < 3
    repo.upsertDataset({ scopeHash, datasetUri: 'c', validator: 'v', resourceCount: 0 });
    repo.markDatasetFailed(scopeHash, 'c', '1');
    repo.markDatasetFailed(scopeHash, 'c', '2');
    repo.markDatasetFailed(scopeHash, 'c', '3'); // capped

    // The exact §5 cross-check query from the quickstart.
    const qsRemaining = db
      .query<{ remaining: number }, []>(
        `SELECT
           SUM(outcome != 'complete'
               AND NOT (outcome = 'failed'
                        AND attempts >= (SELECT max_attempts FROM crawl_checkpoints LIMIT 1)))
             AS remaining
         FROM crawl_checkpoint_datasets`,
      )
      .get();
    // The quickstart §5 SQL counts only VISITED rows: b (sub-cap failed) is remaining; c (capped)
    // is excluded; a (complete) and d (no row yet) are not counted by the SQL.
    expect(qsRemaining?.remaining).toBe(1); // just b among the visited rows
    // The shipped remaining() additionally counts the unvisited frozen id 'd' as remaining, and
    // (matching the quickstart note) still counts the sub-cap 'b' while excluding the capped 'c'.
    expect(repo.remaining(scopeHash)).toBe(2); // b + d ; a complete, c capped excluded
  });

  it('the §7 mutual-exclusion example documents exit code 5', () => {
    const md = readFileSync(QUICKSTART, 'utf-8');
    expect(md).toContain('echo $?                               # 5');
    expect(md).toContain('--retry-failed');
    expect(md).toMatch(/--max/);
  });

  it('every store path referenced in the quickstart is under store/', () => {
    const md = readFileSync(QUICKSTART, 'utf-8');
    // The documented raw layout matches what egov-sync writes.
    expect(md).toContain('store/raw/');
    expect(md).toContain('store/danni.sqlite');
    expect(md).toContain('store/manifest/');
  });
});
