import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Embedder } from '../../../src/index/embedder.ts';
import { LocalOnnxEmbedder } from '../../../src/index/embedders/local-onnx.ts';
import { runIndex } from '../../../src/index/run-index.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

/** A deterministic embedder that records every text it is asked to embed. */
class RecordingEmbedder implements Embedder {
  readonly id: string;
  readonly dimension: number;
  readonly calls: string[] = [];
  constructor(opts: { id?: string; dimension?: number } = {}) {
    this.id = opts.id ?? 'rec:stub';
    this.dimension = opts.dimension ?? 8;
  }
  embed(texts: string[]): Promise<Float32Array[]> {
    for (const t of texts) this.calls.push(t);
    return Promise.resolve(
      texts.map(() => {
        const v = new Float32Array(this.dimension);
        v[0] = 1;
        return v;
      }),
    );
  }
}

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

describe('index.run-index incremental skip gate (T009/T010, US1)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('content_fp match + FTS row present + embed match → skip (skippedUnchanged), no embed call', async () => {
    const e1 = new RecordingEmbedder();
    await runIndex({ db: s.db, embedder: e1 });
    const e2 = new RecordingEmbedder();
    const r = await runIndex({ db: s.db, embedder: e2 });
    expect(e2.calls.length).toBe(0);
    expect(r.embedded).toBe(0);
    expect(r.vectorsUpdated).toBe(0);
    expect(r.ftsUpdated).toBe(0);
    expect(r.skippedUnchanged).toBe(3);
  });

  it('content_fp match but FTS row missing → FTS recompute (presence guard)', async () => {
    const e = new RecordingEmbedder();
    await runIndex({ db: s.db, embedder: e });
    s.db.query('DELETE FROM datasets_fts WHERE dataset_id = ?').run('d2');
    const r = await runIndex({ db: s.db, embedder: e });
    expect(r.ftsUpdated).toBe(1);
    const cnt = s.db
      .query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM datasets_fts WHERE dataset_id = ?')
      .get('d2');
    expect(cnt?.n).toBe(1);
  });

  it('embed_fp match but embedding row missing → re-embed (presence guard, counted embedded)', async () => {
    const e = new RecordingEmbedder();
    await runIndex({ db: s.db, embedder: e });
    s.db.query('DELETE FROM dataset_embeddings WHERE dataset_id = ?').run('d2');
    const e2 = new RecordingEmbedder();
    const r = await runIndex({ db: s.db, embedder: e2 });
    expect(e2.calls.length).toBe(1);
    expect(r.embedded).toBe(1);
    expect(r.vectorsUpdated).toBe(1);
    expect(r.reembeddedDueToModelChange).toBe(0);
  });

  it('content change → recompute both FTS and vector for that dataset only', async () => {
    const e = new RecordingEmbedder();
    await runIndex({ db: s.db, embedder: e });
    new DatasetsRepo(s.db).upsert({
      id: 'd2',
      slug: 'd2',
      titleBg: 'Различно заглавие',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d2',
    });
    const e2 = new RecordingEmbedder();
    const r = await runIndex({ db: s.db, embedder: e2 });
    expect(r.ftsUpdated).toBe(1);
    expect(r.vectorsUpdated).toBe(1);
    expect(r.embedded).toBe(1);
    expect(r.skippedUnchanged).toBe(2);
    expect(e2.calls.length).toBe(1);
  });

  it('per-dataset transactional ordering: content_fp never present without its FTS row; tags-only writes content_fp only', async () => {
    const e = new RecordingEmbedder();
    await runIndex({ db: s.db, embedder: e });
    // every index_state with content_fp must have a matching FTS row
    const orphanedContent = s.db
      .query<{ n: number }, []>(
        'SELECT COUNT(*) AS n FROM index_state s WHERE s.content_fp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM datasets_fts f WHERE f.dataset_id = s.dataset_id)',
      )
      .get();
    expect(orphanedContent?.n).toBe(0);
    const orphanedEmbed = s.db
      .query<{ n: number }, []>(
        'SELECT COUNT(*) AS n FROM index_state s WHERE s.embed_fp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dataset_embeddings d WHERE d.dataset_id = s.dataset_id)',
      )
      .get();
    expect(orphanedEmbed?.n).toBe(0);
  });

  it('config incremental=false recomputes all without a destructive clear', async () => {
    const e = new RecordingEmbedder();
    await runIndex({ db: s.db, embedder: e });
    const e2 = new RecordingEmbedder();
    const r = await runIndex({ db: s.db, embedder: e2, incremental: false });
    expect(e2.calls.length).toBe(3);
    expect(r.embedded).toBe(3);
    expect(r.skippedUnchanged).toBe(0);
  });
});

describe('index.run-index model-change branch (T022/T023, US2)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('embed_fp match but model_id mismatch → re-embed counted under reembeddedDueToModelChange, FTS untouched', async () => {
    const a = new RecordingEmbedder({ id: 'model-a', dimension: 8 });
    await runIndex({ db: s.db, embedder: a });
    const b = new RecordingEmbedder({ id: 'model-b', dimension: 8 });
    const r = await runIndex({ db: s.db, embedder: b });
    expect(r.reembeddedDueToModelChange).toBe(3);
    expect(r.embedded).toBe(0);
    expect(r.ftsUpdated).toBe(0);
    expect(b.calls.length).toBe(3);
  });

  it('same model + same content → both counts 0', async () => {
    const a = new RecordingEmbedder({ id: 'model-a', dimension: 8 });
    await runIndex({ db: s.db, embedder: a });
    const a2 = new RecordingEmbedder({ id: 'model-a', dimension: 8 });
    const r = await runIndex({ db: s.db, embedder: a2 });
    expect(r.reembeddedDueToModelChange).toBe(0);
    expect(r.embedded).toBe(0);
    expect(r.skippedUnchanged).toBe(3);
  });

  it('count-precedence: content AND model both changed → counted once under embedded, not model-change', async () => {
    const a = new RecordingEmbedder({ id: 'model-a', dimension: 8 });
    await runIndex({ db: s.db, embedder: a });
    new DatasetsRepo(s.db).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Съвсем ново заглавие',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d1',
    });
    const b = new RecordingEmbedder({ id: 'model-b', dimension: 8 });
    const r = await runIndex({ db: s.db, embedder: b });
    // d1: content+model changed → embedded; d2,d3: model-only → reembeddedDueToModelChange
    expect(r.embedded).toBe(1);
    expect(r.reembeddedDueToModelChange).toBe(2);
  });

  it('dimension change alone flips the model identity and re-embeds', async () => {
    const a = new RecordingEmbedder({ id: 'same-id', dimension: 8 });
    await runIndex({ db: s.db, embedder: a });
    const b = new RecordingEmbedder({ id: 'same-id', dimension: 16 });
    const r = await runIndex({ db: s.db, embedder: b });
    expect(r.reembeddedDueToModelChange).toBe(3);
  });

  it('records the global embeddings_meta identity at run start (NULL meta → model-changed first run)', async () => {
    const meta0 = s.db
      .query<{ model_id: string | null }, []>('SELECT model_id FROM embeddings_meta WHERE id = 1')
      .get();
    expect(meta0?.model_id).toBeNull();
    const a = new RecordingEmbedder({ id: 'model-a', dimension: 8 });
    const r = await runIndex({ db: s.db, embedder: a });
    expect(r.embedded).toBe(3);
    const meta1 = s.db
      .query<{ model_id: string | null; dimension: number | null }, []>(
        'SELECT model_id, dimension FROM embeddings_meta WHERE id = 1',
      )
      .get();
    expect(meta1?.model_id).toBe('model-a');
    expect(meta1?.dimension).toBe(8);
    const distinct = s.db
      .query<{ model_id: string }, []>('SELECT DISTINCT model_id FROM index_state')
      .all();
    expect(distinct.map((x) => x.model_id)).toEqual(['model-a#8']);
  });
});

describe('index.run-index orphan reconciler (T028)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('purges store rows whose dataset_id is not in listActive() from all three stores', async () => {
    const e = new RecordingEmbedder();
    await runIndex({ db: s.db, embedder: e });
    new DatasetsRepo(s.db).setLifecycle('d2', 'withdrawn');
    const r = await runIndex({ db: s.db, embedder: e });
    expect(r.purged).toBe(1);
    for (const table of ['datasets_fts', 'dataset_embeddings', 'index_state']) {
      const cnt = s.db
        .query<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM ${table} WHERE dataset_id = ?`)
        .get('d2');
      expect(cnt?.n).toBe(0);
    }
  });

  it('never deletes active rows; an empty difference purges nothing', async () => {
    const e = new RecordingEmbedder();
    await runIndex({ db: s.db, embedder: e });
    const r = await runIndex({ db: s.db, embedder: e });
    expect(r.purged).toBe(0);
    const cnt = s.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM index_state').get();
    expect(cnt?.n).toBe(3);
  });
});

describe('index.run-index --full single-transaction rebuild (T032, US3)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('--full re-embeds every active dataset regardless of fingerprints and refreshes index_state', async () => {
    const e1 = new RecordingEmbedder();
    await runIndex({ db: s.db, embedder: e1 });
    const e2 = new RecordingEmbedder();
    const r = await runIndex({ db: s.db, embedder: e2, full: true });
    expect(e2.calls.length).toBe(3);
    expect(r.embedded).toBe(3);
    expect(r.ftsUpdated).toBe(3);
    expect(r.vectorsUpdated).toBe(3);
    const cnt = s.db
      .query<{ n: number }, []>('SELECT COUNT(*) AS n FROM index_state WHERE embed_fp IS NOT NULL')
      .get();
    expect(cnt?.n).toBe(3);
  });

  it('--full clears all three stores then rebuilds (no stale rows for a withdrawn dataset)', async () => {
    const e = new RecordingEmbedder();
    await runIndex({ db: s.db, embedder: e });
    new DatasetsRepo(s.db).setLifecycle('d2', 'withdrawn');
    await runIndex({ db: s.db, embedder: e, full: true });
    for (const table of ['datasets_fts', 'dataset_embeddings', 'index_state']) {
      const cnt = s.db
        .query<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM ${table} WHERE dataset_id = ?`)
        .get('d2');
      expect(cnt?.n).toBe(0);
    }
    const total = s.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM index_state').get();
    expect(total?.n).toBe(2);
  });
});

describe('index.run-index edge branches (T038)', () => {
  function emptyDb(): Database {
    const d = new Database(':memory:');
    d.exec('PRAGMA foreign_keys = ON;');
    runMigrations(d, MIGRATIONS);
    return d;
  }

  it('empty active set: no work, all counts 0 (incremental)', async () => {
    const d = emptyDb();
    const r = await runIndex({ db: d, embedder: new RecordingEmbedder() });
    expect(r).toEqual({
      ftsUpdated: 0,
      vectorsUpdated: 0,
      embedded: 0,
      skippedUnchanged: 0,
      reembeddedDueToModelChange: 0,
      purged: 0,
      embedderRequests: 0,
      skippedEmpty: 0,
      failed: 0,
      failures: [],
    });
    d.close();
  });

  it('empty active set: --full is a no-op too', async () => {
    const d = emptyDb();
    const r = await runIndex({ db: d, embedder: new RecordingEmbedder(), full: true });
    expect(r.embedded).toBe(0);
    d.close();
  });

  it('an empty-text dataset gets an FTS row but no vector (incremental); a re-run skips it', async () => {
    const d = emptyDb();
    new DatasetsRepo(d).upsert({
      id: 'blank',
      slug: 'blank',
      titleBg: '',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/blank',
    });
    const e = new RecordingEmbedder();
    const r1 = await runIndex({ db: d, embedder: e });
    expect(r1.ftsUpdated).toBe(1);
    expect(r1.vectorsUpdated).toBe(0);
    expect(e.calls.length).toBe(0);
    const r2 = await runIndex({ db: d, embedder: new RecordingEmbedder() });
    expect(r2.skippedUnchanged).toBe(1);
    expect(r2.ftsUpdated).toBe(0);
    d.close();
  });

  it('an empty-text dataset under --full gets an FTS row but no vector', async () => {
    const d = emptyDb();
    new DatasetsRepo(d).upsert({
      id: 'blank',
      slug: 'blank',
      titleBg: '',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/blank',
    });
    const e = new RecordingEmbedder();
    const r = await runIndex({ db: d, embedder: e, full: true });
    expect(r.ftsUpdated).toBe(1);
    expect(r.vectorsUpdated).toBe(0);
    expect(e.calls.length).toBe(0);
    d.close();
  });

  it('an embedder returning an empty result array persists no vector', async () => {
    const d = emptyDb();
    new DatasetsRepo(d).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Заглавие',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d1',
    });
    const empties: Embedder = {
      id: 'empty',
      dimension: 8,
      embed: () => Promise.resolve([]),
    };
    const r = await runIndex({ db: d, embedder: empties });
    expect(r.ftsUpdated).toBe(1);
    expect(r.vectorsUpdated).toBe(0);
    const cnt = d.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM dataset_embeddings').get();
    expect(cnt?.n).toBe(0);
    d.close();
  });

  it('--full with an embedder returning an empty result array persists no vector', async () => {
    const d = emptyDb();
    new DatasetsRepo(d).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Заглавие',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d1',
    });
    const empties: Embedder = {
      id: 'empty',
      dimension: 8,
      embed: () => Promise.resolve([]),
    };
    const r = await runIndex({ db: d, embedder: empties, full: true });
    expect(r.ftsUpdated).toBe(1);
    expect(r.vectorsUpdated).toBe(0);
    d.close();
  });

  it('--datasets naming a withdrawn id recomputes nothing but the purge still removes it', async () => {
    const d = emptyDb();
    const ds = new DatasetsRepo(d);
    for (const i of [1, 2]) {
      ds.upsert({
        id: `d${i}`,
        slug: `d${i}`,
        titleBg: `Бюджет ${i}`,
        tags: [],
        groups: [],
        sourceUrl: `https://x/d${i}`,
      });
    }
    const e = new RecordingEmbedder();
    await runIndex({ db: d, embedder: e });
    ds.setLifecycle('d2', 'withdrawn');
    const r = await runIndex({ db: d, embedder: e, datasetIds: ['d2'] });
    expect(r.embedded).toBe(0);
    expect(r.ftsUpdated).toBe(0);
    expect(r.purged).toBe(1);
    d.close();
  });

  it('--datasets naming a missing id is filtered out', async () => {
    const d = emptyDb();
    new DatasetsRepo(d).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Бюджет',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d1',
    });
    const r = await runIndex({ db: d, embedder: new RecordingEmbedder(), datasetIds: ['nope'] });
    expect(r.ftsUpdated).toBe(0);
    d.close();
  });
});

// --- 002-batch-embedding: the seam wiring into 003's loop -----------------------------------

/** Records each embed() invocation as a group of texts (so we can assert ⌈N/B⌉ request counts). */
class BatchRecordingEmbedder implements Embedder {
  readonly id: string;
  readonly dimension: number;
  readonly maxBatchSize?: number;
  readonly batches: string[][] = [];
  constructor(opts: { id?: string; dimension?: number; maxBatchSize?: number } = {}) {
    this.id = opts.id ?? 'rec:stub';
    this.dimension = opts.dimension ?? 8;
    if (opts.maxBatchSize !== undefined) this.maxBatchSize = opts.maxBatchSize;
  }
  get calls(): string[] {
    return this.batches.flat();
  }
  embed(texts: string[]): Promise<Float32Array[]> {
    this.batches.push([...texts]);
    return Promise.resolve(
      texts.map((t) => {
        // Deterministic per-text vector so byte-equivalence holds regardless of batch placement.
        const v = new Float32Array(this.dimension);
        for (let i = 0; i < t.length; i++)
          v[i % this.dimension] = (v[i % this.dimension] ?? 0) + t.charCodeAt(i);
        return v;
      }),
    );
  }
}

const ZERO = (): Promise<void> => Promise.resolve();

describe('index.run-index 002 extended RunIndexResult + FTS-outside-batch (T021)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('populates the four new 002 fields and keeps 003 fields (content-changed run)', async () => {
    const e = new BatchRecordingEmbedder();
    const r = await runIndex({ db: s.db, embedder: e, batchSize: 2, delay: ZERO });
    expect(r.embedded).toBe(3);
    expect(r.vectorsUpdated).toBe(3);
    expect(r.embedderRequests).toBe(2); // ceil(3/2)
    expect(r.skippedEmpty).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.failures).toEqual([]);
    // 003 fields still present
    expect(r.skippedUnchanged).toBe(0);
    expect(r.reembeddedDueToModelChange).toBe(0);
    expect(r.purged).toBe(0);
    expect(r.ftsUpdated).toBe(3);
  });

  it('vectorsUpdated === embedded + reembeddedDueToModelChange === BatchEmbedResult.embedded', async () => {
    const e = new BatchRecordingEmbedder();
    const r = await runIndex({ db: s.db, embedder: e, batchSize: 2, delay: ZERO });
    expect(r.vectorsUpdated).toBe(r.embedded + r.reembeddedDueToModelChange);
  });

  it('FTS upsert count is independent of batch size (per-dataset, outside batching, FR-010)', async () => {
    const e1 = new BatchRecordingEmbedder();
    const r1 = await runIndex({ db: s.db, embedder: e1, batchSize: 1, delay: ZERO });
    const fts1 = r1.ftsUpdated;
    const s2 = setup();
    const e2 = new BatchRecordingEmbedder();
    const r2 = await runIndex({ db: s2.db, embedder: e2, batchSize: 64, delay: ZERO });
    expect(r2.ftsUpdated).toBe(fts1);
    s2.db.close();
  });
});

describe('index.run-index 002 content-vs-model partition (T021b)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('model-change-only batched run: reembeddedDueToModelChange:N, embedded:0, ftsUpdated:0', async () => {
    const a = new BatchRecordingEmbedder({ id: 'model-a', dimension: 8 });
    await runIndex({ db: s.db, embedder: a, batchSize: 2, delay: ZERO });
    const b = new BatchRecordingEmbedder({ id: 'model-b', dimension: 8 });
    const r = await runIndex({ db: s.db, embedder: b, batchSize: 2, delay: ZERO });
    expect(r.reembeddedDueToModelChange).toBe(3);
    expect(r.embedded).toBe(0);
    expect(r.ftsUpdated).toBe(0);
    expect(r.embedderRequests).toBe(2); // batcher still issues ⌈3/2⌉
    expect(r.vectorsUpdated).toBe(3);
  });

  it('content-only change: embedded:N, reembeddedDueToModelChange:0', async () => {
    const a = new BatchRecordingEmbedder({ id: 'model-a', dimension: 8 });
    await runIndex({ db: s.db, embedder: a, batchSize: 2, delay: ZERO });
    new DatasetsRepo(s.db).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Ново заглавие',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d1',
    });
    new DatasetsRepo(s.db).upsert({
      id: 'd2',
      slug: 'd2',
      titleBg: 'Друго ново',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d2',
    });
    new DatasetsRepo(s.db).upsert({
      id: 'd3',
      slug: 'd3',
      titleBg: 'Трето ново',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d3',
    });
    const a2 = new BatchRecordingEmbedder({ id: 'model-a', dimension: 8 });
    const r = await runIndex({ db: s.db, embedder: a2, batchSize: 2, delay: ZERO });
    expect(r.embedded).toBe(3);
    expect(r.reembeddedDueToModelChange).toBe(0);
  });

  it('mixed set splits the two counters and their sum equals vectorsUpdated', async () => {
    const a = new BatchRecordingEmbedder({ id: 'model-a', dimension: 8 });
    await runIndex({ db: s.db, embedder: a, batchSize: 2, delay: ZERO });
    new DatasetsRepo(s.db).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Съвсем ново',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d1',
    });
    const b = new BatchRecordingEmbedder({ id: 'model-b', dimension: 8 });
    const r = await runIndex({ db: s.db, embedder: b, batchSize: 2, delay: ZERO });
    expect(r.embedded).toBe(1); // d1: content+model → embedded
    expect(r.reembeddedDueToModelChange).toBe(2); // d2,d3: model-only
    expect(r.embedded + r.reembeddedDueToModelChange).toBe(r.vectorsUpdated);
  });
});

describe('index.run-index 002 per-dataset persistence + index_failures lifecycle (T022)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('each embedded dataset gets a vector + embed_fp/model_id and any prior failure cleared', async () => {
    // Seed a stale index_failures row for d2.
    s.db
      .query('INSERT INTO index_failures (dataset_id, reason, updated_at) VALUES (?, ?, ?)')
      .run('d2', 'empty_text', '2026-06-01T00:00:00.000Z');
    const e = new BatchRecordingEmbedder();
    await runIndex({ db: s.db, embedder: e, batchSize: 2, delay: ZERO });
    for (const id of ['d1', 'd2', 'd3']) {
      const emb = s.db
        .query<{ n: number }, [string]>(
          'SELECT COUNT(*) AS n FROM dataset_embeddings WHERE dataset_id = ?',
        )
        .get(id);
      expect(emb?.n).toBe(1);
      const st = s.db
        .query<{ embed_fp: string | null; model_id: string | null }, [string]>(
          'SELECT embed_fp, model_id FROM index_state WHERE dataset_id = ?',
        )
        .get(id);
      expect(st?.embed_fp).not.toBeNull();
      expect(st?.model_id).toBe('rec:stub#8');
    }
    // d2's stale failure row cleared once it embedded.
    const fail = s.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM index_failures').get();
    expect(fail?.n).toBe(0);
  });

  it('a dataset failing its single-text retry is recorded in index_failures and failures[]', async () => {
    // Embedder that short-returns d2 on both batch and single retry.
    const e: Embedder = {
      id: 'partial',
      dimension: 8,
      embed: (texts) => {
        const out = texts
          .filter((t) => !t.includes('Бюджет 2'))
          .map(() => {
            const v = new Float32Array(8);
            v[0] = 1;
            return v;
          });
        return Promise.resolve(out);
      },
    };
    const r = await runIndex({ db: s.db, embedder: e, batchSize: 3, delay: ZERO });
    expect(r.failed).toBe(1);
    const f = r.failures.find((x) => x.datasetId === 'd2');
    expect(f?.reason).toMatch(/^single_text_failed:/);
    const persisted = s.db
      .query<{ reason: string }, [string]>('SELECT reason FROM index_failures WHERE dataset_id = ?')
      .get('d2');
    expect(persisted?.reason).toMatch(/^single_text_failed:/);
    expect(r.embedded).toBe(2);
  });

  it('a previously-failing dataset that now embeds has its row cleared (record→clear)', async () => {
    let failD2 = true;
    const mk = (): Embedder => ({
      id: 'flaky',
      dimension: 8,
      embed: (texts) => {
        const out = texts
          .filter((t) => !(failD2 && t.includes('Бюджет 2')))
          .map(() => {
            const v = new Float32Array(8);
            v[0] = 1;
            return v;
          });
        return Promise.resolve(out);
      },
    });
    const r1 = await runIndex({ db: s.db, embedder: mk(), batchSize: 3, delay: ZERO });
    expect(r1.failed).toBe(1);
    expect(s.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM index_failures').get()?.n).toBe(
      1,
    );
    failD2 = false;
    const r2 = await runIndex({ db: s.db, embedder: mk(), batchSize: 3, delay: ZERO });
    expect(r2.embedded).toBe(1); // only d2 needed a vector (it had none)
    expect(s.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM index_failures').get()?.n).toBe(
      0,
    );
  });

  it('an empty-text dataset is recorded empty_text and counted skippedEmpty', async () => {
    new DatasetsRepo(s.db).upsert({
      id: 'blank',
      slug: 'blank',
      titleBg: '',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/blank',
    });
    const e = new BatchRecordingEmbedder();
    const r = await runIndex({ db: s.db, embedder: e, batchSize: 2, delay: ZERO });
    expect(r.skippedEmpty).toBe(1);
    const persisted = s.db
      .query<{ reason: string }, [string]>('SELECT reason FROM index_failures WHERE dataset_id = ?')
      .get('blank');
    expect(persisted?.reason).toBe('empty_text');
  });
});

describe('index.run-index 002 output-equivalence wiring (T023, SC-002)', () => {
  it('batchSize 1 vs 64 persist byte-identical vectors per dataset', async () => {
    const s1 = setup();
    await runIndex({
      db: s1.db,
      embedder: new BatchRecordingEmbedder(),
      batchSize: 1,
      delay: ZERO,
    });
    const s64 = setup();
    await runIndex({
      db: s64.db,
      embedder: new BatchRecordingEmbedder(),
      batchSize: 64,
      delay: ZERO,
    });
    for (const id of ['d1', 'd2', 'd3']) {
      const v1 = s1.db
        .query<{ vector: Buffer }, [string]>(
          'SELECT vector FROM dataset_embeddings WHERE dataset_id = ?',
        )
        .get(id);
      const v64 = s64.db
        .query<{ vector: Buffer }, [string]>(
          'SELECT vector FROM dataset_embeddings WHERE dataset_id = ?',
        )
        .get(id);
      expect(Buffer.compare(v1?.vector as Buffer, v64?.vector as Buffer)).toBe(0);
    }
    s1.db.close();
    s64.db.close();
  });
});

describe('index.run-index 002 orphan purge clears index_failures (T026)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('a withdrawn dataset has its index_failures row purged alongside the other stores', async () => {
    s.db
      .query('INSERT INTO index_failures (dataset_id, reason, updated_at) VALUES (?, ?, ?)')
      .run('d2', 'single_text_failed:x', '2026-06-01T00:00:00.000Z');
    const e = new BatchRecordingEmbedder();
    await runIndex({ db: s.db, embedder: e, batchSize: 2, delay: ZERO });
    // d2 embedded → its seeded failure cleared on success; seed it again, then withdraw.
    s.db
      .query(
        'INSERT OR REPLACE INTO index_failures (dataset_id, reason, updated_at) VALUES (?, ?, ?)',
      )
      .run('d2', 'single_text_failed:x', '2026-06-01T00:00:00.000Z');
    new DatasetsRepo(s.db).setLifecycle('d2', 'withdrawn');
    const r = await runIndex({ db: s.db, embedder: e, batchSize: 2, delay: ZERO });
    expect(r.purged).toBe(1);
    const fail = s.db
      .query<{ n: number }, [string]>(
        'SELECT COUNT(*) AS n FROM index_failures WHERE dataset_id = ?',
      )
      .get('d2');
    expect(fail?.n).toBe(0);
  });
});

describe('index.run-index 002 --full batched path (T024, SC-001/SC-003)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('--full embeds the whole active set in ⌈N/B⌉ requests and reports the 002 counts', async () => {
    const e = new BatchRecordingEmbedder();
    const r = await runIndex({ db: s.db, embedder: e, full: true, batchSize: 2, delay: ZERO });
    expect(e.batches.length).toBe(2); // ceil(3/2)
    expect(r.embedderRequests).toBe(2);
    expect(r.embedded).toBe(3);
    expect(r.vectorsUpdated).toBe(3);
    expect(r.failed).toBe(0);
  });

  it('--full records an empty-text dataset as skippedEmpty + empty_text', async () => {
    new DatasetsRepo(s.db).upsert({
      id: 'blank',
      slug: 'blank',
      titleBg: '',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/blank',
    });
    const e = new BatchRecordingEmbedder();
    const r = await runIndex({ db: s.db, embedder: e, full: true, batchSize: 8, delay: ZERO });
    expect(r.skippedEmpty).toBe(1);
    expect(r.embedded).toBe(3);
    const persisted = s.db
      .query<{ reason: string }, [string]>('SELECT reason FROM index_failures WHERE dataset_id = ?')
      .get('blank');
    expect(persisted?.reason).toBe('empty_text');
  });

  it('--full forces single-text when the embedder declares maxBatchSize === 1', async () => {
    const e = new BatchRecordingEmbedder({ maxBatchSize: 1 });
    const r = await runIndex({ db: s.db, embedder: e, full: true, batchSize: 64, delay: ZERO });
    expect(e.batches.every((b) => b.length === 1)).toBe(true);
    expect(r.embedderRequests).toBe(3);
  });
});

describe('index.run-index 002 maxBatchSize resolution (T024)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('config maxBatchSize caps the effective batch size', async () => {
    const e = new BatchRecordingEmbedder();
    await runIndex({ db: s.db, embedder: e, batchSize: 64, maxBatchSize: 1, delay: ZERO });
    expect(e.batches.every((b) => b.length === 1)).toBe(true);
  });

  it('provider maxBatchSize caps the effective batch size', async () => {
    const e = new BatchRecordingEmbedder({ maxBatchSize: 2 });
    await runIndex({ db: s.db, embedder: e, batchSize: 64, delay: ZERO });
    expect(e.batches.every((b) => b.length <= 2)).toBe(true);
    expect(e.batches.length).toBe(2); // ceil(3/2)
  });
});
