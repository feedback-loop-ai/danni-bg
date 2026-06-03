import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../src/index/embedders/local-onnx.ts';
import { search } from '../../src/index/query.ts';
import { runIndex } from '../../src/index/run-index.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { DatasetsRepo } from '../../src/store/repos/datasets.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('integration.perf-search', () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db, join(ROOT, 'migrations'));
    const ds = new DatasetsRepo(db);
    for (let i = 0; i < 50; i++) {
      ds.upsert({
        id: `d${i}`,
        slug: `d${i}`,
        titleBg: `Бюджет ${i}`,
        descriptionBg: `Описание за дата сет ${i}`,
        tags: [],
        groups: [],
        sourceUrl: `https://x/d${i}`,
      });
    }
  });
  afterEach(() => {
    db.close();
  });

  it('top-5 retrieval completes in well under 1s on the fixture corpus', async () => {
    const embedder = new LocalOnnxEmbedder({ dimension: 32 });
    await runIndex({ db, embedder });
    const t0 = performance.now();
    const out = await search({ db, embedder, query: 'бюджет', limit: 5 });
    const elapsedMs = performance.now() - t0;
    expect(out.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(1000);
  });
});
