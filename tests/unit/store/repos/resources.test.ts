import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../../src/store/repos/datasets.ts';
import { ResourcesRepo } from '../../../../src/store/repos/resources.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  // Seed parent dataset for FK
  new DatasetsRepo(d).upsert({
    id: 'd1',
    slug: 'd1',
    titleBg: 'Title',
    tags: [],
    groups: [],
    sourceUrl: 'https://example.org/d1',
  });
  return d;
}

describe('store.repos.resources', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('inserts a new resource', () => {
    const repo = new ResourcesRepo(database);
    const row = repo.upsert({
      id: 'r1',
      datasetId: 'd1',
      sourceUrl: 'https://example.org/r1.csv',
      declaredFormat: 'csv',
      position: 2,
      name: 'r1',
    });
    expect(row.id).toBe('r1');
    expect(row.position).toBe(2);
    expect(row.last_outcome).toBe('success');
  });

  it('upsert updates an existing resource', () => {
    const repo = new ResourcesRepo(database);
    repo.upsert({
      id: 'r1',
      datasetId: 'd1',
      sourceUrl: 'https://example.org/r1.csv',
      declaredFormat: 'csv',
    });
    const row = repo.upsert({
      id: 'r1',
      datasetId: 'd1',
      sourceUrl: 'https://example.org/r1-updated.csv',
      declaredFormat: 'json',
    });
    expect(row.source_url).toBe('https://example.org/r1-updated.csv');
    expect(row.declared_format).toBe('json');
  });

  it('recordCapture writes blob fields', () => {
    const repo = new ResourcesRepo(database);
    repo.upsert({
      id: 'r1',
      datasetId: 'd1',
      sourceUrl: 'https://example.org/r1.csv',
    });
    repo.recordCapture({
      id: 'r1',
      bytes: 100,
      sha256: 'a'.repeat(64),
      rawPath: 'd1/r1/abc.csv',
      detectedFormat: 'csv',
      detectedContentType: 'text/csv',
      etag: '"abc"',
      lastModified: 'Wed, 01 Jan 2020 00:00:00 GMT',
      outcome: 'success',
    });
    const row = repo.get('r1');
    expect(row?.bytes).toBe(100);
    expect(row?.sha256).toBe('a'.repeat(64));
    expect(row?.detected_format).toBe('csv');
    expect(row?.etag).toBe('"abc"');
  });

  it('recordOutcome updates last_outcome and reason', () => {
    const repo = new ResourcesRepo(database);
    repo.upsert({
      id: 'r1',
      datasetId: 'd1',
      sourceUrl: 'https://example.org/r1.csv',
    });
    repo.recordOutcome('r1', 'failure', 'boom');
    const row = repo.get('r1');
    expect(row?.last_outcome).toBe('failure');
    expect(row?.last_failure_reason).toBe('boom');
  });

  it('setLifecycle marks state', () => {
    const repo = new ResourcesRepo(database);
    repo.upsert({
      id: 'r1',
      datasetId: 'd1',
      sourceUrl: 'https://example.org/r1.csv',
    });
    repo.setLifecycle('r1', 'withdrawn');
    expect(repo.get('r1')?.lifecycle_state).toBe('withdrawn');
  });

  it('listByDataset orders by position then id', () => {
    const repo = new ResourcesRepo(database);
    repo.upsert({
      id: 'rB',
      datasetId: 'd1',
      sourceUrl: 'https://example.org/b',
      position: 1,
    });
    repo.upsert({
      id: 'rA',
      datasetId: 'd1',
      sourceUrl: 'https://example.org/a',
      position: 0,
    });
    const list = repo.listByDataset('d1').map((r) => r.id);
    expect(list).toEqual(['rA', 'rB']);
  });
});
