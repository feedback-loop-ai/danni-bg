import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Embedder } from '../../../src/index/embedder.ts';
import type { FtsRow } from '../../../src/index/fts.ts';
import {
  IndexStateRepo,
  contentFp,
  embedFp,
  modelIdOf,
  serializeFtsRow,
} from '../../../src/index/index-state.ts';
import { sha256Hex } from '../../../src/lib/hash.ts';
import { runMigrations } from '../../../src/store/migrate.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function freshDb(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  // index_state FK -> datasets(id); seed a couple of dataset rows.
  for (const id of ['d1', 'd2', 'd3']) {
    d.query(
      `INSERT INTO datasets (id, slug, title_bg, description_bg, publisher_id, license_id, tags_json, groups_json, source_url, metadata_created, metadata_modified, first_seen_at, last_synced_at, source_etag_or_hash, lifecycle_state, lifecycle_changed_at, withdrawn_reason) VALUES (?, ?, 'T', NULL, NULL, NULL, '[]', '[]', 'https://x', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'active', '2026-01-01T00:00:00.000Z', NULL)`,
    ).run(id, id);
  }
  return d;
}

function emptyRow(datasetId: string): FtsRow {
  return {
    dataset_id: datasetId,
    title_bg: '',
    title_en: '',
    description_bg: '',
    description_en: '',
    publisher_label: '',
    tag_labels: '',
    group_labels: '',
    column_labels: '',
    entity_labels: '',
  };
}

describe('index_state migration shape (T006)', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it('creates the index_state table', () => {
    const t = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='index_state'",
      )
      .get();
    expect(t?.name).toBe('index_state');
  });

  it('has dataset_id as PRIMARY KEY and three nullable fingerprint columns + NOT NULL updated_at', () => {
    const cols = db
      .query<{ name: string; notnull: number; pk: number }, []>('PRAGMA table_info(index_state)')
      .all();
    const byName = new Map(cols.map((c) => [c.name, c]));
    expect(byName.get('dataset_id')?.pk).toBe(1);
    expect(byName.get('content_fp')?.notnull).toBe(0);
    expect(byName.get('embed_fp')?.notnull).toBe(0);
    expect(byName.get('model_id')?.notnull).toBe(0);
    expect(byName.get('updated_at')?.notnull).toBe(1);
  });

  it('rejects a row with NULL updated_at', () => {
    expect(() =>
      db
        .query('INSERT INTO index_state (dataset_id, content_fp, updated_at) VALUES (?, ?, NULL)')
        .run('d1', 'abc'),
    ).toThrow();
  });
});

describe('IndexStateRepo (T007)', () => {
  let db: Database;
  let repo: IndexStateRepo;
  beforeEach(() => {
    db = freshDb();
    repo = new IndexStateRepo(db);
  });
  afterEach(() => {
    db.close();
  });

  it('get returns null on an unknown dataset', () => {
    expect(repo.get('nope')).toBeNull();
  });

  it('upsertContent then upsertEmbed accumulate into one row', () => {
    repo.upsertContent('d1', 'cfp');
    repo.upsertEmbed('d1', 'efp', 'm#8');
    const row = repo.get('d1');
    expect(row?.content_fp).toBe('cfp');
    expect(row?.embed_fp).toBe('efp');
    expect(row?.model_id).toBe('m#8');
    expect(row?.updated_at).toBeTruthy();
  });

  it('upsertContent alone leaves embed_fp/model_id NULL (NULL-tolerant read)', () => {
    repo.upsertContent('d1', 'cfp');
    const row = repo.get('d1');
    expect(row?.content_fp).toBe('cfp');
    expect(row?.embed_fp).toBeNull();
    expect(row?.model_id).toBeNull();
  });

  it('upsertEmbed alone leaves content_fp NULL', () => {
    repo.upsertEmbed('d1', 'efp', 'm#8');
    const row = repo.get('d1');
    expect(row?.content_fp).toBeNull();
    expect(row?.embed_fp).toBe('efp');
    expect(row?.model_id).toBe('m#8');
  });

  it('partial merge: a later upsertContent does not clobber a prior embed_fp/model_id (FR-003 tags-only)', () => {
    repo.upsertEmbed('d1', 'efp', 'm#8');
    repo.upsertContent('d1', 'cfp2');
    const row = repo.get('d1');
    expect(row?.content_fp).toBe('cfp2');
    expect(row?.embed_fp).toBe('efp');
    expect(row?.model_id).toBe('m#8');
  });

  it('a later upsertEmbed does not clobber a prior content_fp', () => {
    repo.upsertContent('d1', 'cfp');
    repo.upsertEmbed('d1', 'efp2', 'm#16');
    const row = repo.get('d1');
    expect(row?.content_fp).toBe('cfp');
    expect(row?.embed_fp).toBe('efp2');
    expect(row?.model_id).toBe('m#16');
  });

  it('upsertContent updates updated_at when an explicit now is passed', () => {
    repo.upsertContent('d1', 'cfp', '2030-01-01T00:00:00.000Z');
    expect(repo.get('d1')?.updated_at).toBe('2030-01-01T00:00:00.000Z');
  });

  it('upsertEmbed honors an explicit now', () => {
    repo.upsertEmbed('d1', 'efp', 'm#8', '2031-01-01T00:00:00.000Z');
    expect(repo.get('d1')?.updated_at).toBe('2031-01-01T00:00:00.000Z');
  });

  it('delete removes the row', () => {
    repo.upsertContent('d1', 'cfp');
    repo.delete('d1');
    expect(repo.get('d1')).toBeNull();
  });

  it('listDatasetIds returns exactly the inserted ids', () => {
    repo.upsertContent('d1', 'a');
    repo.upsertEmbed('d2', 'b', 'm#8');
    expect(repo.listDatasetIds().sort()).toEqual(['d1', 'd2']);
  });

  it('listDatasetIds is empty on a fresh ledger', () => {
    expect(repo.listDatasetIds()).toEqual([]);
  });
});

describe('fingerprint helpers (T008)', () => {
  it('serializeFtsRow emits the 9 ordered label=value lines, empties included', () => {
    const out = serializeFtsRow(emptyRow('d1'));
    const lines = [
      'title_bg=',
      'title_en=',
      'description_bg=',
      'description_en=',
      'publisher_label=',
      'tag_labels=',
      'group_labels=',
      'column_labels=',
      'entity_labels=',
    ];
    expect(out).toBe(`${lines.join('\n')}\n`);
  });

  it('serializeFtsRow excludes dataset_id from the digest input', () => {
    const a = serializeFtsRow(emptyRow('d1'));
    const b = serializeFtsRow(emptyRow('d2'));
    expect(a).toBe(b);
  });

  it('a value moving across a field boundary changes the digest', () => {
    const inTitle: FtsRow = { ...emptyRow('d1'), title_bg: 'Бюджет' };
    const inDesc: FtsRow = { ...emptyRow('d1'), description_bg: 'Бюджет' };
    expect(contentFp(inTitle)).not.toBe(contentFp(inDesc));
  });

  it('contentFp equals sha256Hex of serializeFtsRow', () => {
    const row: FtsRow = { ...emptyRow('d1'), title_bg: 'A', tag_labels: 'b c' };
    expect(contentFp(row)).toBe(sha256Hex(serializeFtsRow(row)));
  });

  it('Cyrillic round-trip: a Cyrillic FtsRow hashes deterministically byte-exact', () => {
    const row: FtsRow = {
      ...emptyRow('d1'),
      title_bg: 'Държавен бюджет 2025',
      description_bg: 'Описание с кирилица и числа № 42',
      entity_labels: 'Министерство на финансите',
    };
    const fp1 = contentFp(row);
    const fp2 = contentFp({ ...row });
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[a-f0-9]{64}$/);
    // No normalization: equals the raw sha of the exact serialized UTF-8.
    expect(fp1).toBe(sha256Hex(serializeFtsRow(row)));
  });

  it('embedFp equals sha256Hex of the raw text (no trimming/reordering)', () => {
    const text = '  Бюджет\nbudget  \n';
    expect(embedFp(text)).toBe(sha256Hex(text));
  });

  it('embedFp distinguishes whitespace-only differences', () => {
    expect(embedFp('a\nb')).not.toBe(embedFp('a b'));
  });

  it('modelIdOf formats `${id}#${dimension}`', () => {
    const e: Embedder = {
      id: 'local-onnx:hash-stub-32',
      dimension: 384,
      embed: () => Promise.resolve([]),
    };
    expect(modelIdOf(e)).toBe('local-onnx:hash-stub-32#384');
  });
});
