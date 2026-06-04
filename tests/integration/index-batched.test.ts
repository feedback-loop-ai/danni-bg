import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Embedder } from '../../src/index/embedder.ts';
import { runIndex } from '../../src/index/run-index.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { DatasetsRepo } from '../../src/store/repos/datasets.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');
const ZERO = (): Promise<void> => Promise.resolve();

/**
 * Records each embed() invocation as a batch (group of texts) and returns a deterministic,
 * per-text vector (pure function of the text) — so a vector NEVER depends on which batch it was
 * placed in (output-equivalence by construction, FR-006).
 */
class RecordingEmbedder implements Embedder {
  readonly id: string;
  readonly dimension: number;
  readonly maxBatchSize?: number;
  readonly batches: string[][] = [];
  constructor(opts: { id?: string; dimension?: number; maxBatchSize?: number } = {}) {
    this.id = opts.id ?? 'rec:stub';
    this.dimension = opts.dimension ?? 16;
    if (opts.maxBatchSize !== undefined) this.maxBatchSize = opts.maxBatchSize;
  }
  embed(texts: string[]): Promise<Float32Array[]> {
    this.batches.push([...texts]);
    return Promise.resolve(texts.map((t) => vec(t, this.dimension)));
  }
}

function vec(text: string, dim: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < text.length; i++) {
    const idx = text.charCodeAt(i) % dim;
    v[idx] = (v[idx] ?? 0) + 1;
  }
  return v;
}

function seed(db: Database, n: number): void {
  const ds = new DatasetsRepo(db);
  for (let i = 0; i < n; i++) {
    ds.upsert({
      id: `d${i}`,
      slug: `d${i}`,
      // Mix Cyrillic + ASCII so the byte-equivalence test (SC-002) covers Bulgarian text.
      titleBg: `Бюджет на община ${i} — данни ${i}`,
      tags: [],
      groups: [],
      sourceUrl: `https://x/d${i}`,
    });
  }
}

function newDb(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  return d;
}

function vectorDigest(db: Database): string {
  const rows = db
    .query<{ dataset_id: string; vector: Buffer }, []>(
      'SELECT dataset_id, vector FROM dataset_embeddings ORDER BY dataset_id',
    )
    .all();
  const h = createHash('sha256');
  for (const r of rows) {
    h.update(r.dataset_id);
    h.update(r.vector);
  }
  return h.digest('hex');
}

describe('integration.index-batched SC-001 request count (T027)', () => {
  let db: Database;
  beforeEach(() => {
    db = newDb();
  });
  afterEach(() => {
    db.close();
  });

  it('issues ⌈N/B⌉ requests (far fewer than N), one vector per dataset, ≤ B texts per call', async () => {
    seed(db, 20);
    const e = new RecordingEmbedder();
    const r = await runIndex({ db, embedder: e, full: true, batchSize: 6, delay: ZERO });
    expect(e.batches.length).toBe(Math.ceil(20 / 6)); // 4
    expect(r.embedderRequests).toBe(Math.ceil(20 / 6));
    expect(e.batches.every((b) => b.length <= 6)).toBe(true);
    const cnt = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM dataset_embeddings').get();
    expect(cnt?.n).toBe(20);
    expect(r.embedded).toBe(20);
  });
});

describe('integration.index-batched SC-002 byte-identical batch 1 vs 64 (T028, incl. Cyrillic)', () => {
  it('persists byte-identical vectors per dataset regardless of batch size', async () => {
    const db1 = newDb();
    seed(db1, 12);
    await runIndex({
      db: db1,
      embedder: new RecordingEmbedder(),
      full: true,
      batchSize: 1,
      delay: ZERO,
    });
    const d1 = vectorDigest(db1);

    const db64 = newDb();
    seed(db64, 12);
    await runIndex({
      db: db64,
      embedder: new RecordingEmbedder(),
      full: true,
      batchSize: 64,
      delay: ZERO,
    });
    const d64 = vectorDigest(db64);

    expect(d64).toBe(d1);

    // Also assert per-row byte equality (not just the rolled-up digest).
    for (let i = 0; i < 12; i++) {
      const v1 = db1
        .query<{ vector: Buffer }, [string]>(
          'SELECT vector FROM dataset_embeddings WHERE dataset_id = ?',
        )
        .get(`d${i}`);
      const v64 = db64
        .query<{ vector: Buffer }, [string]>(
          'SELECT vector FROM dataset_embeddings WHERE dataset_id = ?',
        )
        .get(`d${i}`);
      expect(Buffer.compare(v1?.vector as Buffer, v64?.vector as Buffer)).toBe(0);
    }
    db1.close();
    db64.close();
  });
});

describe('integration.index-batched SC-004 transient batch failure salvaged (T029)', () => {
  it('salvages a short-returning batch via single-text retries; only genuinely-failing texts recorded', async () => {
    const db = newDb();
    seed(db, 6);
    let shortedOnce = false;
    const e: Embedder = {
      id: 'flaky',
      dimension: 16,
      embed: (texts) => {
        // Short the first multi-text batch exactly once → fail-whole-batch → single retries.
        if (!shortedOnce && texts.length > 1) {
          shortedOnce = true;
          return Promise.resolve(texts.slice(0, texts.length - 1).map((t) => vec(t, 16)));
        }
        // On the single-text retries, dataset d2 always short-returns (a real per-text fault).
        const out = texts.filter((t) => !t.includes('община 2 ')).map((t) => vec(t, 16));
        return Promise.resolve(out);
      },
    };
    const r = await runIndex({ db, embedder: e, full: true, batchSize: 3, delay: ZERO });
    expect(r.failed).toBe(1);
    expect(r.failures[0]?.datasetId).toBe('d2');
    expect(r.failures[0]?.reason).toMatch(/^single_text_failed:/);
    // embedderRequests includes the failed batch + the single-text retries.
    expect(r.embedderRequests).toBeGreaterThan(Math.ceil(6 / 3));
    // The failure is persisted to index_failures with the same reason.
    const persisted = db
      .query<{ reason: string }, [string]>('SELECT reason FROM index_failures WHERE dataset_id = ?')
      .get('d2');
    expect(persisted?.reason).toMatch(/^single_text_failed:/);
    expect(r.embedded).toBe(5);
    db.close();
  });

  it('a healthy provider salvages the whole batch (failed: 0)', async () => {
    const db = newDb();
    seed(db, 6);
    let shortedOnce = false;
    const e: Embedder = {
      id: 'recovers',
      dimension: 16,
      embed: (texts) => {
        if (!shortedOnce && texts.length > 1) {
          shortedOnce = true;
          return Promise.resolve(texts.slice(0, texts.length - 1).map((t) => vec(t, 16)));
        }
        return Promise.resolve(texts.map((t) => vec(t, 16)));
      },
    };
    const r = await runIndex({ db, embedder: e, full: true, batchSize: 3, delay: ZERO });
    expect(r.failed).toBe(0);
    expect(r.embedded).toBe(6);
    db.close();
  });
});

describe('integration.index-batched SC-003 no dataset un-embedded except empty-text (T030)', () => {
  it('every active non-empty dataset has a vector; only empty_text rows in index_failures', async () => {
    const db = newDb();
    seed(db, 10);
    // One empty-text dataset (no title) — must be left un-embedded and recorded empty_text.
    new DatasetsRepo(db).upsert({
      id: 'blank',
      slug: 'blank',
      titleBg: '',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/blank',
    });
    await runIndex({
      db,
      embedder: new RecordingEmbedder(),
      full: true,
      batchSize: 4,
      delay: ZERO,
    });

    // quickstart §SC-003 SQL: missing = 0
    const missing = db
      .query<{ missing: number }, []>(
        `SELECT COUNT(*) AS missing
         FROM datasets d
         WHERE d.lifecycle_state = 'active'
           AND NOT EXISTS (SELECT 1 FROM dataset_embeddings e WHERE e.dataset_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM index_failures f WHERE f.dataset_id = d.id AND f.reason LIKE 'empty_text%')`,
      )
      .get();
    expect(missing?.missing).toBe(0);

    // The only index_failures rows are empty_text ones.
    const reasons = db
      .query<{ reason: string }, []>('SELECT DISTINCT reason FROM index_failures')
      .all();
    expect(reasons.map((r) => r.reason)).toEqual(['empty_text']);
    db.close();
  });
});
