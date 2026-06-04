import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Embedder } from '../../src/index/embedder.ts';
import { LocalOnnxEmbedder } from '../../src/index/embedders/local-onnx.ts';
import { runIndex } from '../../src/index/run-index.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { DatasetsRepo } from '../../src/store/repos/datasets.ts';
import { EntitiesRepo } from '../../src/store/repos/entities.ts';
import { TranslationsRepo } from '../../src/store/repos/translations.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Embedder that maps text → a content-derived vector and records its calls. */
class ContentEmbedder implements Embedder {
  readonly id: string;
  readonly dimension: number;
  readonly calls: string[] = [];
  constructor(opts: { id?: string; dimension?: number } = {}) {
    this.id = opts.id ?? 'content:stub';
    this.dimension = opts.dimension ?? 8;
  }
  embed(texts: string[]): Promise<Float32Array[]> {
    for (const t of texts) this.calls.push(t);
    return Promise.resolve(
      texts.map((t) => {
        const v = new Float32Array(this.dimension);
        for (let i = 0; i < t.length; i++) {
          const idx = t.charCodeAt(i) % this.dimension;
          v[idx] = (v[idx] ?? 0) + 1;
        }
        return v;
      }),
    );
  }
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

function ftsRowSet(db: Database): string[] {
  return db
    .query<{ dataset_id: string }, []>('SELECT dataset_id FROM datasets_fts ORDER BY dataset_id')
    .all()
    .map((r) => r.dataset_id);
}

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

describe('integration.index-incremental US1/US2/purge/full (003)', () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db, join(ROOT, 'migrations'));
    const ds = new DatasetsRepo(db);
    for (const i of [1, 2, 3, 4]) {
      ds.upsert({
        id: `d${i}`,
        slug: `d${i}`,
        titleBg: `Бюджет ${i}`,
        descriptionBg: `Описание ${i}`,
        tags: [`tag${i}`],
        groups: [],
        sourceUrl: `https://x/d${i}`,
      });
    }
  });
  afterEach(() => {
    db.close();
  });

  const N = 4;

  it('SC-001: a no-op re-index re-embeds zero datasets and leaves vectors byte-identical', async () => {
    const e = new ContentEmbedder();
    await runIndex({ db, embedder: e, full: true });
    const before = vectorDigest(db);
    const e2 = new ContentEmbedder();
    const r = await runIndex({ db, embedder: e2 });
    expect(r.embedded).toBe(0);
    expect(r.vectorsUpdated).toBe(0);
    expect(r.skippedUnchanged).toBe(N);
    expect(e2.calls.length).toBe(0);
    expect(vectorDigest(db)).toBe(before);
  });

  describe('SC-002: changing exactly one FR-002 input re-embeds exactly that dataset', () => {
    const cases: Array<{ name: string; mutate: (db: Database) => void }> = [
      {
        name: 'title',
        mutate: (db) => {
          new DatasetsRepo(db).upsert({
            id: 'd2',
            slug: 'd2',
            titleBg: 'Изцяло ново заглавие',
            descriptionBg: 'Описание 2',
            tags: ['tag2'],
            groups: [],
            sourceUrl: 'https://x/d2',
          });
        },
      },
      {
        name: 'description',
        mutate: (db) => {
          new DatasetsRepo(db).upsert({
            id: 'd2',
            slug: 'd2',
            titleBg: 'Бюджет 2',
            descriptionBg: 'Преработено описание',
            tags: ['tag2'],
            groups: [],
            sourceUrl: 'https://x/d2',
          });
        },
      },
      {
        name: 'machine-translation',
        mutate: (db) => {
          new TranslationsRepo(db).upsert({
            subjectKind: 'dataset_title',
            subjectId: 'd2',
            textBg: 'Бюджет 2',
            textEn: 'Budget number two',
            translator: 'mt',
            confidence: 0.9,
          });
        },
      },
      {
        name: 'attached-entity',
        mutate: (db) => {
          const ents = new EntitiesRepo(db);
          ents.upsert({
            id: 'ent-fin',
            kind: 'organization',
            canonicalLabelBg: 'Министерство на финансите',
            canonicalLabelEn: 'Ministry of Finance',
          });
          ents.attach({ datasetId: 'd2', entityId: 'ent-fin', extractor: 'ner', confidence: 0.9 });
        },
      },
    ];

    for (const c of cases) {
      it(`re-embeds only d2 when ${c.name} changes`, async () => {
        const e = new ContentEmbedder();
        await runIndex({ db, embedder: e, full: true });
        const before = db
          .query<{ embed_fp: string }, [string]>(
            'SELECT embed_fp FROM index_state WHERE dataset_id = ?',
          )
          .get('d2');
        c.mutate(db);
        const e2 = new ContentEmbedder();
        const r = await runIndex({ db, embedder: e2 });
        expect(r.embedded).toBe(1);
        expect(r.vectorsUpdated).toBe(1);
        expect(r.skippedUnchanged).toBe(N - 1);
        const after = db
          .query<{ embed_fp: string }, [string]>(
            'SELECT embed_fp FROM index_state WHERE dataset_id = ?',
          )
          .get('d2');
        expect(after?.embed_fp).not.toBe(before?.embed_fp);
      });
    }

    it('a newly-added dataset is embedded without re-embedding any unchanged one', async () => {
      const e = new ContentEmbedder();
      await runIndex({ db, embedder: e, full: true });
      new DatasetsRepo(db).upsert({
        id: 'd5',
        slug: 'd5',
        titleBg: 'Нов набор от данни',
        descriptionBg: 'Описание 5',
        tags: ['tag5'],
        groups: [],
        sourceUrl: 'https://x/d5',
      });
      const e2 = new ContentEmbedder();
      const r = await runIndex({ db, embedder: e2 });
      expect(r.embedded).toBe(1);
      expect(r.skippedUnchanged).toBe(N);
      expect(e2.calls.length).toBe(1);
    });
  });

  it('FR-003: a tags-only change refreshes FTS but does NOT re-embed', async () => {
    const e = new ContentEmbedder();
    await runIndex({ db, embedder: e, full: true });
    const contentBefore = db
      .query<{ content_fp: string; embed_fp: string }, [string]>(
        'SELECT content_fp, embed_fp FROM index_state WHERE dataset_id = ?',
      )
      .get('d2');
    new DatasetsRepo(db).upsert({
      id: 'd2',
      slug: 'd2',
      titleBg: 'Бюджет 2',
      descriptionBg: 'Описание 2',
      tags: ['нов-таг', 'друг-таг'],
      groups: [],
      sourceUrl: 'https://x/d2',
    });
    const e2 = new ContentEmbedder();
    const r = await runIndex({ db, embedder: e2 });
    expect(r.ftsUpdated).toBe(1);
    expect(r.vectorsUpdated).toBe(0);
    expect(r.embedded).toBe(0);
    expect(e2.calls.length).toBe(0);
    const contentAfter = db
      .query<{ content_fp: string; embed_fp: string }, [string]>(
        'SELECT content_fp, embed_fp FROM index_state WHERE dataset_id = ?',
      )
      .get('d2');
    expect(contentAfter?.content_fp).not.toBe(contentBefore?.content_fp);
    expect(contentAfter?.embed_fp).toBe(contentBefore?.embed_fp);
  });

  it('two datasets with identical content are fingerprinted/skipped independently', async () => {
    const dsRepo = new DatasetsRepo(db);
    for (const id of ['twin-a', 'twin-b']) {
      dsRepo.upsert({
        id,
        slug: id,
        titleBg: 'Еднакво съдържание',
        descriptionBg: 'Еднакво описание',
        tags: ['same'],
        groups: [],
        sourceUrl: `https://x/${id}`,
      });
    }
    const e = new ContentEmbedder();
    await runIndex({ db, embedder: e, full: true });
    // change only twin-a
    dsRepo.upsert({
      id: 'twin-a',
      slug: 'twin-a',
      titleBg: 'Различно сега',
      descriptionBg: 'Еднакво описание',
      tags: ['same'],
      groups: [],
      sourceUrl: 'https://x/twin-a',
    });
    const e2 = new ContentEmbedder();
    const r = await runIndex({ db, embedder: e2 });
    expect(r.embedded).toBe(1);
    expect(e2.calls.length).toBe(1);
    // twin-b stays skipped
    const twinBState = db
      .query<{ content_fp: string }, [string]>(
        'SELECT content_fp FROM index_state WHERE dataset_id = ?',
      )
      .get('twin-b');
    expect(twinBState?.content_fp).toBeTruthy();
  });

  it('interrupted-run convergence: a fingerprint with no store row is recomputed (presence guard)', async () => {
    const e = new ContentEmbedder();
    await runIndex({ db, embedder: e, full: true });
    // Simulate an interrupted run: index_state kept, store rows gone for d3.
    db.query('DELETE FROM datasets_fts WHERE dataset_id = ?').run('d3');
    db.query('DELETE FROM dataset_embeddings WHERE dataset_id = ?').run('d3');
    const e2 = new ContentEmbedder();
    const r = await runIndex({ db, embedder: e2 });
    expect(r.ftsUpdated).toBe(1);
    expect(r.vectorsUpdated).toBe(1);
    expect(e2.calls.length).toBe(1);
    const cntFts = db
      .query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM datasets_fts WHERE dataset_id = ?')
      .get('d3');
    expect(cntFts?.n).toBe(1);
  });

  it('SC-003: switching embedder models re-embeds the whole corpus, FTS untouched', async () => {
    const a = new ContentEmbedder({ id: 'model-a', dimension: 8 });
    await runIndex({ db, embedder: a, full: true });
    const b = new ContentEmbedder({ id: 'model-b', dimension: 16 });
    const r = await runIndex({ db, embedder: b });
    expect(r.reembeddedDueToModelChange).toBe(N);
    expect(r.embedded).toBe(0);
    expect(r.ftsUpdated).toBe(0);
    const meta = db
      .query<{ model_id: string; dimension: number }, []>(
        'SELECT model_id, dimension FROM embeddings_meta WHERE id = 1',
      )
      .get();
    expect(meta?.model_id).toBe('model-b');
    expect(meta?.dimension).toBe(16);
    const distinct = db
      .query<{ model_id: string }, []>('SELECT DISTINCT model_id FROM index_state')
      .all();
    expect(distinct.map((x) => x.model_id)).toEqual(['model-b#16']);
    // re-run with same model: nothing re-embeds
    const b2 = new ContentEmbedder({ id: 'model-b', dimension: 16 });
    const r2 = await runIndex({ db, embedder: b2 });
    expect(r2.skippedUnchanged).toBe(N);
    expect(r2.reembeddedDueToModelChange).toBe(0);
  });

  it('SC-004: a withdrawn dataset is purged from all three stores', async () => {
    const e = new ContentEmbedder();
    await runIndex({ db, embedder: e, full: true });
    new DatasetsRepo(db).setLifecycle('d2', 'withdrawn');
    const r = await runIndex({ db, embedder: e });
    expect(r.purged).toBe(1);
    for (const table of ['datasets_fts', 'dataset_embeddings', 'index_state']) {
      const cnt = db
        .query<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM ${table} WHERE dataset_id = ?`)
        .get('d2');
      expect(cnt?.n).toBe(0);
    }
  });

  it('FR-006: the purge runs full-corpus even under a --datasets subset that excludes the withdrawn id', async () => {
    const e = new ContentEmbedder();
    await runIndex({ db, embedder: e, full: true });
    new DatasetsRepo(db).setLifecycle('d2', 'withdrawn');
    const r = await runIndex({ db, embedder: e, datasetIds: ['d1'] });
    expect(r.purged).toBe(1);
    for (const table of ['datasets_fts', 'dataset_embeddings', 'index_state']) {
      const cnt = db
        .query<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM ${table} WHERE dataset_id = ?`)
        .get('d2');
      expect(cnt?.n).toBe(0);
    }
    // d3 (active, not named) keeps its rows
    const d3 = db
      .query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM index_state WHERE dataset_id = ?')
      .get('d3');
    expect(d3?.n).toBe(1);
  });

  it('SC-005: an arbitrary incremental sequence == a single --full on the same final state', async () => {
    const e = new ContentEmbedder({ id: 'model-a', dimension: 8 });
    await runIndex({ db, embedder: e, full: true });
    // add
    const dsRepo = new DatasetsRepo(db);
    dsRepo.upsert({
      id: 'd6',
      slug: 'd6',
      titleBg: 'Шести набор',
      descriptionBg: 'Описание 6',
      tags: ['t6'],
      groups: [],
      sourceUrl: 'https://x/d6',
    });
    await runIndex({ db, embedder: e });
    // change content
    dsRepo.upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Променено заглавие',
      descriptionBg: 'Описание 1',
      tags: ['tag1'],
      groups: [],
      sourceUrl: 'https://x/d1',
    });
    await runIndex({ db, embedder: e });
    // tags-only
    dsRepo.upsert({
      id: 'd3',
      slug: 'd3',
      titleBg: 'Бюджет 3',
      descriptionBg: 'Описание 3',
      tags: ['нов'],
      groups: [],
      sourceUrl: 'https://x/d3',
    });
    await runIndex({ db, embedder: e });
    // withdraw
    dsRepo.setLifecycle('d4', 'withdrawn');
    await runIndex({ db, embedder: e });
    // model switch
    const e2 = new ContentEmbedder({ id: 'model-b', dimension: 8 });
    await runIndex({ db, embedder: e2 });

    const incFts = ftsRowSet(db);
    const incVec = vectorDigest(db);

    // Now --full on the same final state with the same (current) model.
    const e3 = new ContentEmbedder({ id: 'model-b', dimension: 8 });
    await runIndex({ db, embedder: e3, full: true });

    expect(ftsRowSet(db)).toEqual(incFts);
    expect(vectorDigest(db)).toBe(incVec);
  });
});
