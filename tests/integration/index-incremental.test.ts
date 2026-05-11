import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../src/index/embedders/local-onnx.ts';
import { runIndex } from '../../src/index/run-index.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { DatasetsRepo } from '../../src/store/repos/datasets.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('integration.index-incremental', () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db, join(ROOT, 'migrations'));
    const ds = new DatasetsRepo(db);
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
  });
  afterEach(() => {
    db.close();
  });

  it('runIndex with --datasets only updates the targeted dataset', async () => {
    const embedder = new LocalOnnxEmbedder({ dimension: 8 });
    await runIndex({ db, embedder });
    // Mutate one dataset
    new DatasetsRepo(db).upsert({
      id: 'd2',
      slug: 'd2',
      titleBg: 'Нов заглавен ред',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d2',
    });
    const r = await runIndex({ db, embedder, datasetIds: ['d2'] });
    expect(r.ftsUpdated).toBe(1);
    const out = db
      .query<{ dataset_id: string }, [string]>(
        'SELECT dataset_id FROM datasets_fts WHERE datasets_fts MATCH ?',
      )
      .all('"Нов"');
    expect(out.map((r) => r.dataset_id)).toEqual(['d2']);
  });
});
