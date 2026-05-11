import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectWithdrawals } from '../../../src/crawler/withdrawn.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { ResourcesRepo } from '../../../src/store/repos/resources.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  return d;
}

describe('crawler.withdrawn', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('marks active datasets absent from observed set as withdrawn', () => {
    const datasets = new DatasetsRepo(database);
    const resources = new ResourcesRepo(database);
    datasets.upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'A',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d1',
    });
    resources.upsert({
      id: 'r1',
      datasetId: 'd1',
      sourceUrl: 'https://x/d1.csv',
    });
    datasets.upsert({
      id: 'd2',
      slug: 'd2',
      titleBg: 'B',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d2',
    });

    const events = detectWithdrawals({
      db: database,
      runId: 'run-1',
      observedDatasetIds: new Set(['d2']),
    });
    expect(events.length).toBe(1);
    expect(events[0]?.datasetId).toBe('d1');
    expect(datasets.get('d1')?.lifecycle_state).toBe('withdrawn');
    expect(resources.get('r1')?.lifecycle_state).toBe('withdrawn');
    expect(datasets.get('d2')?.lifecycle_state).toBe('active');
  });

  it('returns no events when all datasets observed', () => {
    new DatasetsRepo(database).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'A',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d1',
    });
    const events = detectWithdrawals({
      db: database,
      runId: 'run-1',
      observedDatasetIds: new Set(['d1']),
    });
    expect(events.length).toBe(0);
  });
});
