import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureDataset } from '../../../src/crawler/capture-dataset.ts';
import type { CkanClient } from '../../../src/crawler/ckan-client.ts';
import type { PackageShowResponse } from '../../../src/crawler/ckan-schema.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetRevisionsRepo } from '../../../src/store/repos/dataset-revisions.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { OrganizationsRepo } from '../../../src/store/repos/organizations.ts';
import { ResourcesRepo } from '../../../src/store/repos/resources.ts';
import { SyncRunsRepo } from '../../../src/store/repos/sync-runs.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FIX = fileURLToPath(new URL('../../fixtures/portal/', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  new SyncRunsRepo(d).create({ id: 'r1', trigger: 'manual', scopeFilterJson: '{}' });
  return d;
}

function loadShow(name: string): PackageShowResponse {
  return JSON.parse(
    readFileSync(join(FIX, 'package_show', `${name}.json`), 'utf-8'),
  ) as PackageShowResponse;
}

function makeClient(showByName: Record<string, PackageShowResponse>): CkanClient {
  return {
    packageShow: async (id: string) => {
      const out = Object.values(showByName).find((p) => p.result.id === id || p.result.name === id);
      if (!out) throw new Error(`unknown id ${id}`);
      return out;
    },
  } as unknown as CkanClient;
}

describe('crawler.capture-dataset', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('upserts organization, dataset, and resources from a CKAN package_show', async () => {
    const client = makeClient({ standard: loadShow('standard') });
    const out = await captureDataset(
      {
        db: database,
        client,
        runId: 'r1',
        portalBaseUrl: 'https://data.egov.bg/api/3/action/',
      },
      '00000000-0000-0000-0000-000000000001',
    );
    expect(out.metadataHash.length).toBe(64);
    expect(out.resources.length).toBe(1);
    const dataset = new DatasetsRepo(database).get('00000000-0000-0000-0000-000000000001');
    expect(dataset?.title_bg).toBe('Първи набор от данни');
    const org = new OrganizationsRepo(database).get('11111111-1111-1111-1111-111111111111');
    expect(org?.title_bg).toBe('Столична община');
    const r = new ResourcesRepo(database).get('aaaa1111-aaaa-1111-aaaa-111111111111');
    expect(r?.declared_format).toBe('CSV');
  });

  it('records dataset_revisions when fields change on second capture', async () => {
    const client = makeClient({ standard: loadShow('standard') });
    await captureDataset(
      {
        db: database,
        client,
        runId: 'r1',
        portalBaseUrl: 'https://data.egov.bg/api/3/action/',
      },
      '00000000-0000-0000-0000-000000000001',
    );
    // Mutate a field in the in-memory fixture
    const std = loadShow('standard');
    std.result.title = 'Нов заглавен ред';
    const client2 = {
      packageShow: async () => std,
    } as unknown as CkanClient;
    await captureDataset(
      {
        db: database,
        client: client2,
        runId: 'r1',
        portalBaseUrl: 'https://data.egov.bg/api/3/action/',
      },
      '00000000-0000-0000-0000-000000000001',
    );
    const revs = new DatasetRevisionsRepo(database).listForDataset(
      '00000000-0000-0000-0000-000000000001',
    );
    expect(revs.find((r) => r.field === 'title_bg')?.new_value).toBe('Нов заглавен ред');
  });
});
