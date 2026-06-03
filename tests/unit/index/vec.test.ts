import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../../src/index/embedders/local-onnx.ts';
import { listEmbeddings } from '../../../src/index/embeddings-store.ts';
import { composeEmbeddingText, upsertEmbeddingFor } from '../../../src/index/vec.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function setup(): { db: Database } {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  new DatasetsRepo(d).upsert({
    id: 'd1',
    slug: 'd1',
    titleBg: 'Бюджет',
    descriptionBg: 'Описание',
    tags: [],
    groups: [],
    sourceUrl: 'https://x/d1',
  });
  return { db: d };
}

describe('index.vec', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('upsertEmbeddingFor stores a vector keyed by dataset', async () => {
    const e = new LocalOnnxEmbedder({ dimension: 16 });
    await upsertEmbeddingFor({ db: s.db, embedder: e }, 'd1');
    const rows = listEmbeddings(s.db);
    expect(rows.length).toBe(1);
    expect(rows[0]?.vector.length).toBe(16);
  });

  it('skips when dataset is missing or text empty', async () => {
    const e = new LocalOnnxEmbedder({ dimension: 8 });
    await upsertEmbeddingFor({ db: s.db, embedder: e }, 'missing');
    expect(listEmbeddings(s.db).length).toBe(0);
  });

  it('composeEmbeddingText returns empty for missing dataset', () => {
    expect(composeEmbeddingText(s.db, 'missing')).toBe('');
  });

  it('updates embeddings_meta when model identity changes', async () => {
    const e1 = new LocalOnnxEmbedder({ dimension: 4 });
    const e2 = new LocalOnnxEmbedder({ dimension: 8, modelId: 'other' });
    await upsertEmbeddingFor({ db: s.db, embedder: e1 }, 'd1');
    await upsertEmbeddingFor({ db: s.db, embedder: e2 }, 'd1');
    const meta = s.db
      .query<{ dimension: number; model_id: string }, []>(
        'SELECT dimension, model_id FROM embeddings_meta WHERE id = 1',
      )
      .get();
    expect(meta?.dimension).toBe(8);
    expect(meta?.model_id).toContain('other');
  });
});
