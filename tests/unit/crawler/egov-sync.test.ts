import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EgovBgClient } from '../../../src/crawler/egov-bg-client.ts';
import { rowsToCsv, runEgovSync } from '../../../src/crawler/egov-sync.ts';
import { runCurate } from '../../../src/curate/run-curate.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { CuratedArtifactsRepo } from '../../../src/store/repos/curated-artifacts.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { OrganizationsRepo } from '../../../src/store/repos/organizations.ts';
import { ResourcesRepo } from '../../../src/store/repos/resources.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FIX = fileURLToPath(new URL('../../fixtures/egov/', import.meta.url));
const fix = (n: string) => JSON.parse(readFileSync(join(FIX, `${n}.json`), 'utf-8'));
const DATASET_URI = fix('getDatasetDetails').data.uri as string;

function fakeClient(overrides: Partial<Record<string, () => unknown>> = {}): EgovBgClient {
  return {
    listDatasets: async () => overrides.listDatasets?.() ?? fix('listDatasets'),
    getDatasetDetails: async () => fix('getDatasetDetails'),
    listResources: async () => overrides.listResources?.() ?? fix('listResources'),
    getResourceData: async () => overrides.getResourceData?.() ?? fix('getResourceData'),
    listOrganisations: async () => fix('listOrganisations'),
  } as unknown as EgovBgClient;
}

function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db, join(ROOT, 'migrations'));
  return db;
}

describe('crawler.egov-sync', () => {
  it('rowsToCsv serializes a header + rows with CSV escaping', () => {
    expect(
      rowsToCsv([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toBe('a,b\n1,2\n');
    expect(
      rowsToCsv([
        ['x,y', 'a"b'],
        ['p\nq', 5],
      ]),
    ).toBe('"x,y","a""b"\n"p\nq",5\n');
    expect(rowsToCsv([['n', null]])).toBe('n,\n');
  });

  it('captures real-shaped datastore data into the store and DB (explicit URIs)', async () => {
    const db = freshDb();
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const result = await runEgovSync({
      db,
      storeRoot,
      client: fakeClient(),
      datasetUris: [DATASET_URI],
    });

    expect(result.datasets).toBe(1);
    expect(result.resources).toBe(3);
    expect(result.captured).toBe(3);
    expect(result.failures).toBe(0);

    const ds = new DatasetsRepo(db).get(DATASET_URI);
    expect(ds?.title_bg.length).toBeGreaterThan(0);
    expect(ds?.publisher_id).toBe('egov-org-113');
    expect(JSON.parse(ds?.tags_json ?? '[]')).toContain('ППС');

    // org row materialized (placeholder name when not in the org pages)
    expect(new OrganizationsRepo(db).get('egov-org-113')).not.toBeNull();

    const resources = new ResourcesRepo(db).listByDataset(DATASET_URI);
    expect(resources.length).toBe(3);
    const r0 = resources[0];
    expect(r0?.declared_format).toBe('csv');
    expect(r0?.last_outcome).toBe('success');
    expect(r0?.raw_path).toBeTruthy();
    expect(existsSync(join(storeRoot, 'raw', r0?.raw_path as string))).toBe(true);
    // CSV starts with the datastore header row
    const csv = readFileSync(join(storeRoot, 'raw', r0?.raw_path as string), 'utf-8');
    expect(csv.startsWith('РЕГИОН,')).toBe(true);
    db.close();
  });

  it('enumerates via listDatasets when no URIs are given (respects maxDatasets)', async () => {
    const db = freshDb();
    const result = await runEgovSync({
      db,
      storeRoot: globalThis.__TEST_TMP_DIR__,
      client: fakeClient(),
      maxDatasets: 1,
    });
    expect(result.datasets).toBe(1);
    expect(result.captured).toBe(3);
    db.close();
  });

  it('records a failure for an empty datastore resource', async () => {
    const db = freshDb();
    const result = await runEgovSync({
      db,
      storeRoot: globalThis.__TEST_TMP_DIR__,
      client: fakeClient({ getResourceData: () => ({ success: true, data: [] }) }),
      datasetUris: [DATASET_URI],
    });
    expect(result.captured).toBe(0);
    expect(result.failures).toBe(3);
    const r0 = new ResourcesRepo(db).listByDataset(DATASET_URI)[0];
    expect(r0?.last_outcome).toBe('failure');
    db.close();
  });

  it('captured CSVs curate into tabular artifacts (end-to-end on real-shaped data)', async () => {
    const db = freshDb();
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    await runEgovSync({ db, storeRoot, client: fakeClient(), datasetUris: [DATASET_URI] });
    const curated = await runCurate({ db, storeRoot, curatorVersion: 'egov-test' });
    expect(curated.curated).toBe(3);
    const artifacts = new CuratedArtifactsRepo(db).byDataset(DATASET_URI);
    expect(artifacts.every((a) => a.kind === 'tabular')).toBe(true);
    db.close();
  });
});
