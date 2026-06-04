import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../../src/index/embedders/local-onnx.ts';
import { evaluateRecall } from '../../../src/index/eval.ts';
import { runIndex } from '../../../src/index/run-index.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';

const MIGRATIONS = fileURLToPath(new URL('../../../migrations', import.meta.url));

async function seeded(): Promise<{ db: Database; embedder: LocalOnnxEmbedder }> {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db, MIGRATIONS);
  const ds = new DatasetsRepo(db);
  ds.upsert({
    id: 'd-budget',
    slug: 'd-budget',
    titleBg: 'Бюджет на София 2025',
    tags: [],
    groups: [],
    sourceUrl: 'https://data.egov.bg/data/view/d-budget',
  });
  ds.upsert({
    id: 'd-pop',
    slug: 'd-pop',
    titleBg: 'Население на Пловдив',
    tags: [],
    groups: [],
    sourceUrl: 'https://data.egov.bg/data/view/d-pop',
  });
  const embedder = new LocalOnnxEmbedder({ dimension: 16 });
  await runIndex({ db, embedder });
  return { db, embedder };
}

describe('index.eval evaluateRecall (SC-004 harness)', () => {
  it('computes recall@K overall + split by language and lists the misses', async () => {
    const { db, embedder } = await seeded();
    const report = await evaluateRecall({
      db,
      embedder,
      limit: 5,
      queries: [
        { query: 'бюджет', lang: 'bg', expected: ['d-budget'] }, // FTS keyword hit
        { query: 'население', lang: 'bg', expected: ['d-pop'] }, // FTS keyword hit
        { query: 'no-such-token-xyz', lang: 'en', expected: ['d-nonexistent'] }, // guaranteed miss
      ],
    });
    expect(report.total).toBe(3);
    expect(report.hits).toBe(2);
    expect(report.recallAtK).toBeCloseTo(2 / 3, 5);
    expect(report.byLang.bg).toEqual({ total: 2, hits: 2, recall: 1 });
    expect(report.byLang.en).toEqual({ total: 1, hits: 0, recall: 0 });
    expect(report.misses).toHaveLength(1);
    expect(report.misses[0]?.query).toBe('no-such-token-xyz');
    expect(report.misses[0]?.lang).toBe('en');
    expect(report.misses[0]?.expected).toEqual(['d-nonexistent']);
    expect(Array.isArray(report.misses[0]?.got)).toBe(true);
    db.close();
  });

  it('handles an empty query set without dividing by zero', async () => {
    const { db, embedder } = await seeded();
    const report = await evaluateRecall({ db, embedder, queries: [] });
    expect(report.total).toBe(0);
    expect(report.recallAtK).toBe(0);
    expect(report.byLang.bg.recall).toBe(0);
    expect(report.byLang.en.recall).toBe(0);
    db.close();
  });

  it('defaults the top-K cutoff to 5', async () => {
    const { db, embedder } = await seeded();
    const report = await evaluateRecall({
      db,
      embedder,
      queries: [{ query: 'бюджет', lang: 'bg', expected: ['d-budget'] }],
    });
    expect(report.limit).toBe(5);
    db.close();
  });
});
