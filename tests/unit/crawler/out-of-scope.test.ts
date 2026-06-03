import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileOutOfScope } from '../../../src/crawler/out-of-scope.ts';
import { buildScopePredicate } from '../../../src/crawler/scope.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { OrganizationsRepo } from '../../../src/store/repos/organizations.ts';
import { ResourcesRepo } from '../../../src/store/repos/resources.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  return d;
}

describe('crawler.out-of-scope', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('moves active datasets failing the predicate to out_of_scope', () => {
    const orgs = new OrganizationsRepo(database);
    orgs.upsert({ id: 'pubA', slug: 'pubA', titleBg: 'A', sourceUrl: 'https://x/a' });
    orgs.upsert({ id: 'pubB', slug: 'pubB', titleBg: 'B', sourceUrl: 'https://x/b' });
    const datasets = new DatasetsRepo(database);
    const resources = new ResourcesRepo(database);
    datasets.upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'A',
      tags: ['old'],
      groups: ['gA'],
      publisherId: 'pubA',
      sourceUrl: 'https://x/d1',
    });
    resources.upsert({ id: 'r1', datasetId: 'd1', sourceUrl: 'https://x/r1' });
    datasets.upsert({
      id: 'd2',
      slug: 'd2',
      titleBg: 'B',
      tags: ['new'],
      groups: ['gB'],
      publisherId: 'pubB',
      sourceUrl: 'https://x/d2',
    });

    const predicate = buildScopePredicate({ publishers: ['pubB'] });
    const events = reconcileOutOfScope({
      db: database,
      runId: 'run-1',
      scopePredicate: predicate,
    });
    expect(events.map((e) => e.datasetId)).toEqual(['d1']);
    expect(datasets.get('d1')?.lifecycle_state).toBe('out_of_scope');
    expect(resources.get('r1')?.lifecycle_state).toBe('out_of_scope');
    expect(datasets.get('d2')?.lifecycle_state).toBe('active');
  });

  it('returns no events when every active dataset matches', () => {
    new DatasetsRepo(database).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'A',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d1',
    });
    const events = reconcileOutOfScope({
      db: database,
      runId: 'run-1',
      scopePredicate: () => true,
    });
    expect(events.length).toBe(0);
  });
});
