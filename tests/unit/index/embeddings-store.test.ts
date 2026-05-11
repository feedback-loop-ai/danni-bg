import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deleteEmbedding,
  ensureEmbeddingsTable,
  getEmbeddingsMeta,
  listEmbeddings,
  setEmbeddingsMeta,
  upsertEmbedding,
} from '../../../src/index/embeddings-store.ts';
import { runMigrations } from '../../../src/store/migrate.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  ensureEmbeddingsTable(d);
  return d;
}

describe('index.embeddings-store', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('upserts and lists vectors', () => {
    const v = Float32Array.from([1, 2, 3, 4]);
    upsertEmbedding(database, 'd1', v);
    const list = listEmbeddings(database);
    expect(list.length).toBe(1);
    expect(Array.from(list[0]?.vector ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('replaces on second upsert', () => {
    upsertEmbedding(database, 'd1', Float32Array.from([1]));
    upsertEmbedding(database, 'd1', Float32Array.from([9, 9]));
    const list = listEmbeddings(database);
    expect(list.length).toBe(1);
    expect(Array.from(list[0]?.vector ?? [])).toEqual([9, 9]);
  });

  it('deletes', () => {
    upsertEmbedding(database, 'd1', Float32Array.from([1]));
    deleteEmbedding(database, 'd1');
    expect(listEmbeddings(database).length).toBe(0);
  });

  it('reads + writes embeddings_meta', () => {
    setEmbeddingsMeta(database, 'm1', 32);
    const meta = getEmbeddingsMeta(database);
    expect(meta.model_id).toBe('m1');
    expect(meta.dimension).toBe(32);
  });

  it('throws when meta row missing', () => {
    database.exec('DELETE FROM embeddings_meta');
    expect(() => getEmbeddingsMeta(database)).toThrow();
  });
});
