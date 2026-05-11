import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../../src/index/embedders/local-onnx.ts';
import { runIndex } from '../../../src/index/run-index.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function setup(): { db: Database } {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  const ds = new DatasetsRepo(d);
  for (const i of [1, 2, 3]) {
    ds.upsert({
      id: `d${i}`,
      slug: `d${i}`,
      titleBg: `Бюджет ${i}`,
      tags: [],
      groups: [],
      sourceUrl: `https://x/d${i}`,
    });
  }
  return { db: d };
}

describe('index.run-index', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('indexes all active datasets and reports counts', async () => {
    const r = await runIndex({ db: s.db, embedder: new LocalOnnxEmbedder({ dimension: 8 }) });
    expect(r.ftsUpdated).toBe(3);
    expect(r.vectorsUpdated).toBe(3);
  });

  it('--full clears the FTS table before reindexing', async () => {
    await runIndex({ db: s.db, embedder: new LocalOnnxEmbedder({ dimension: 8 }) });
    await runIndex({ db: s.db, embedder: new LocalOnnxEmbedder({ dimension: 8 }), full: true });
    const cnt = s.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM datasets_fts').get();
    expect(cnt?.n).toBe(3);
  });

  it('respects --datasets filter', async () => {
    const r = await runIndex({
      db: s.db,
      embedder: new LocalOnnxEmbedder({ dimension: 8 }),
      datasetIds: ['d2'],
    });
    expect(r.ftsUpdated).toBe(1);
  });

  it('skips withdrawn datasets and removes them from FTS', async () => {
    new DatasetsRepo(s.db).setLifecycle('d2', 'withdrawn');
    await runIndex({ db: s.db, embedder: new LocalOnnxEmbedder({ dimension: 8 }) });
    const cnt = s.db
      .query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM datasets_fts WHERE dataset_id = ?')
      .get('d2');
    expect(cnt?.n).toBe(0);
  });

  it('ignores unknown ids in --datasets', async () => {
    const r = await runIndex({
      db: s.db,
      embedder: new LocalOnnxEmbedder({ dimension: 8 }),
      datasetIds: ['missing'],
    });
    expect(r.ftsUpdated).toBe(0);
  });
});
