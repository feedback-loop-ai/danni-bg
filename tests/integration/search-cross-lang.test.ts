import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../src/index/embedders/local-onnx.ts';
import { search } from '../../src/index/query.ts';
import { runIndex } from '../../src/index/run-index.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { seedCrossLangCorpus } from '../fixtures/search/cross-lang-corpus.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const QUERY_SET_PATH = join(ROOT, 'tests/fixtures/search/query-set.json');

interface QueryEntry {
  query: string;
  lang: 'bg' | 'en';
  expected: string[];
  rationale: string;
}

interface QueryFile {
  queries: QueryEntry[];
}

async function setup(): Promise<{ db: Database; embedder: LocalOnnxEmbedder }> {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, join(ROOT, 'migrations'));
  seedCrossLangCorpus(d);
  const embedder = new LocalOnnxEmbedder({ dimension: 32 });
  await runIndex({ db: d, embedder });
  return { db: d, embedder };
}

describe('integration.search-cross-lang', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('≥75% of query-set queries surface the expected dataset within top 5 (relaxed threshold for fixture corpus)', async () => {
    const queryFile = JSON.parse(readFileSync(QUERY_SET_PATH, 'utf-8')) as QueryFile;
    let hits = 0;
    let total = 0;
    for (const q of queryFile.queries) {
      total++;
      const results = await search({ db: s.db, embedder: s.embedder, query: q.query, limit: 5 });
      const ids = results.map((r) => r.datasetId);
      const expected = q.expected;
      if (expected.some((eid) => ids.includes(eid))) hits++;
    }
    // SC-004 production target is ≥90% on a real curated corpus. The fixture corpus is small
    // and the embedder is a hash stub, so we settle for ≥75% as a CI smoke threshold.
    const ratio = hits / total;
    expect(ratio).toBeGreaterThanOrEqual(0.75);
  });

  it('every result carries sourceUrl and curatedDatasetPath (FR-013)', async () => {
    const results = await search({ db: s.db, embedder: s.embedder, query: 'бюджет', limit: 3 });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.sourceUrl.startsWith('http')).toBe(true);
      expect(r.curatedDatasetPath.length).toBeGreaterThan(0);
    }
  });
});
