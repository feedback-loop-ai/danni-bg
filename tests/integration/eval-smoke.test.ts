import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../src/index/embedders/local-onnx.ts';
import { type RecallQuery, evaluateRecall } from '../../src/index/eval.ts';
import { runIndex } from '../../src/index/run-index.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { CROSS_LANG_CORPUS, seedCrossLangCorpus } from '../fixtures/search/cross-lang-corpus.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const QUERY_SET_PATH = join(ROOT, 'tests/fixtures/search/query-set.json');

// CI smoke for the SC-004 recall harness (`evaluateRecall` / `danni eval`): runs the shipped
// bilingual query set against the shared corpus with the deterministic stub embedder — offline.
// A real recall@5 number (0.90 SC-004 target) needs a real embedder + real corpus; that is run
// operationally (docs/semantic-search.md; verified live against the Qwen-8B spark box at 100%).
describe('integration.eval-smoke', () => {
  let db: Database;
  let embedder: LocalOnnxEmbedder;
  let queries: RecallQuery[];
  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db, join(ROOT, 'migrations'));
    seedCrossLangCorpus(db);
    embedder = new LocalOnnxEmbedder({ dimension: 32 });
    await runIndex({ db, embedder });
    queries = (JSON.parse(readFileSync(QUERY_SET_PATH, 'utf-8')) as { queries: RecallQuery[] })
      .queries;
  });
  afterEach(() => db.close());

  it('the shipped query set is well-formed: every expected id exists in the corpus', () => {
    const ids = new Set(CROSS_LANG_CORPUS.map((c) => c.id));
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q.expected.length).toBeGreaterThan(0);
      for (const e of q.expected) expect(ids.has(e)).toBe(true);
    }
  });

  it('evaluateRecall over the shipped query set meets the CI floor and splits by language', async () => {
    const report = await evaluateRecall({ db, embedder, queries, limit: 5 });
    expect(report.total).toBe(queries.length);
    // Stub embedder + tiny corpus → CI floor ≥0.75 (mirrors search-cross-lang). The 0.90 SC-004
    // target is for a real embedder + real corpus, asserted operationally, not in CI.
    expect(report.recallAtK).toBeGreaterThanOrEqual(0.75);
    expect(report.byLang.bg.total).toBeGreaterThan(0);
    expect(report.byLang.en.total).toBeGreaterThan(0);
    expect(report.byLang.bg.hits).toBeGreaterThan(0);
    expect(report.byLang.en.hits).toBeGreaterThan(0);
    expect(Array.isArray(report.misses)).toBe(true);
  });
});
