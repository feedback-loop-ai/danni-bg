import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IndexFailuresRepo } from '../../../../src/store/repos/index-failures.ts';
import { runMigrations } from '../../../../src/store/migrate.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function setup(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  return d;
}

interface ColInfo {
  name: string;
  notnull: number;
  pk: number;
}

describe('store.index_failures migration shape (T005, data-model §1/§5)', () => {
  let db: Database;
  beforeEach(() => {
    db = setup();
  });
  afterEach(() => {
    db.close();
  });

  it('creates index_failures with dataset_id PRIMARY KEY, reason/updated_at NOT NULL', () => {
    const cols = db.query<ColInfo, []>('PRAGMA table_info(index_failures)').all();
    const byName = new Map(cols.map((c) => [c.name, c]));
    // SQLite: a non-INTEGER PRIMARY KEY is reported via `pk`, not `notnull` (PRIMARY KEY does
    // not imply NOT NULL for a TEXT key column). reason/updated_at carry explicit NOT NULL.
    expect(byName.get('dataset_id')?.pk).toBe(1);
    expect(byName.get('reason')?.notnull).toBe(1);
    expect(byName.get('updated_at')?.notnull).toBe(1);
  });
});

describe('store.IndexFailuresRepo record/clear/list (T006, FR-008)', () => {
  let db: Database;
  let repo: IndexFailuresRepo;
  beforeEach(() => {
    db = setup();
    repo = new IndexFailuresRepo(db);
  });
  afterEach(() => {
    db.close();
  });

  it('record upserts (a second record overwrites reason and bumps updated_at, never appends)', () => {
    repo.record('d1', 'empty_text', '2026-06-03T00:00:00.000Z');
    repo.record('d1', 'single_text_failed:boom', '2026-06-04T00:00:00.000Z');
    const rows = repo.list();
    expect(rows.length).toBe(1);
    expect(rows[0]?.dataset_id).toBe('d1');
    expect(rows[0]?.reason).toBe('single_text_failed:boom');
    expect(rows[0]?.updated_at).toBe('2026-06-04T00:00:00.000Z');
  });

  it('record honors an injected now and defaults to nowIso() when omitted', () => {
    repo.record('d1', 'empty_text');
    const rows = repo.list();
    expect(rows[0]?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('clear deletes the row', () => {
    repo.record('d1', 'empty_text', '2026-06-03T00:00:00.000Z');
    repo.clear('d1');
    expect(repo.list()).toEqual([]);
  });

  it('clear is a no-op when the row is absent', () => {
    expect(() => repo.clear('ghost')).not.toThrow();
    expect(repo.list()).toEqual([]);
  });

  it('list returns typed rows ordered by dataset_id', () => {
    repo.record('d3', 'empty_text', '2026-06-03T00:00:00.000Z');
    repo.record('d1', 'empty_text', '2026-06-03T00:00:00.000Z');
    repo.record('d2', 'transient_exhausted:429', '2026-06-03T00:00:00.000Z');
    const rows = repo.list();
    expect(rows.map((r) => r.dataset_id)).toEqual(['d1', 'd2', 'd3']);
    expect(rows[1]?.reason).toBe('transient_exhausted:429');
  });
});
