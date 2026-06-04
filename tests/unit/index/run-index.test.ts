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
