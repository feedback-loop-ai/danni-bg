import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { DatasetRevisionsRepo } from '../../../../src/store/repos/dataset-revisions.ts';
import { DatasetsRepo } from '../../../../src/store/repos/datasets.ts';
import { SyncRunsRepo } from '../../../../src/store/repos/sync-runs.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  new DatasetsRepo(d).upsert({
    id: 'd1',
    slug: 'd1',
    titleBg: 'A',
    tags: [],
    groups: [],
    sourceUrl: 'https://x/d1',
  });
  new SyncRunsRepo(d).create({ id: 'run-1', trigger: 'manual', scopeFilterJson: '{}' });
  return d;
}

describe('store.repos.dataset-revisions', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('inserts and lists revisions in order', () => {
    const repo = new DatasetRevisionsRepo(database);
    repo.insert({
      datasetId: 'd1',
      field: 'title_bg',
      oldValue: 'A',
      newValue: 'B',
      runId: 'run-1',
      observedAt: '2026-05-08T00:00:00Z',
    });
    repo.insert({
      datasetId: 'd1',
      field: 'description_bg',
      oldValue: null,
      newValue: 'desc',
      runId: 'run-1',
      observedAt: '2026-05-08T00:00:01Z',
    });
    const rows = repo.listForDataset('d1');
    expect(rows.length).toBe(2);
    expect(rows[0]?.field).toBe('title_bg');
    expect(rows[1]?.new_value).toBe('desc');
  });

  it('falls back to nowIso for observedAt when omitted', () => {
    const repo = new DatasetRevisionsRepo(database);
    repo.insert({
      datasetId: 'd1',
      field: 'tags_json',
      oldValue: '[]',
      newValue: '["x"]',
      runId: 'run-1',
    });
    const row = repo.listForDataset('d1')[0];
    expect(row?.observed_at).toBeDefined();
    expect(typeof row?.observed_at).toBe('string');
  });
});
