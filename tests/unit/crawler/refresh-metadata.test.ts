import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type DatasetDetailFetcher,
  refreshMetadata,
} from '../../../src/crawler/refresh-metadata.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function setup(): { db: Database; repo: DatasetsRepo } {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db, join(ROOT, 'migrations'));
  const repo = new DatasetsRepo(db);
  repo.upsert({
    id: 'ds-1',
    slug: 'ds-1',
    titleBg: 'Заглавие 1',
    tags: ['t'],
    groups: [],
    sourceUrl: 'https://x/ds-1',
  });
  repo.upsert({
    id: 'ds-2',
    slug: 'ds-2',
    titleBg: 'Заглавие 2',
    tags: [],
    groups: [],
    sourceUrl: 'https://x/ds-2',
  });
  return { db, repo };
}

describe('crawler.refresh-metadata', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => s.db.close());

  it('backfills metadata_created/modified from the portal details, preserving other fields', async () => {
    const client: DatasetDetailFetcher = {
      getDatasetDetails: async (uri) => ({
        data: { created_at: '2026-06-03T16:47:30Z', updated_at: `2026-06-05T17:08:29Z-${uri}` },
      }),
    };
    const res = await refreshMetadata({ repo: s.repo, client, now: () => '2026-06-17T00:00:00Z' });
    expect(res).toEqual({ total: 2, refreshed: 2, failed: 0 });
    const d1 = s.repo.get('ds-1');
    expect(d1?.metadata_created).toBe('2026-06-03T16:47:30Z');
    expect(d1?.metadata_modified).toBe('2026-06-05T17:08:29Z-ds-1');
    expect(d1?.last_synced_at).toBe('2026-06-17T00:00:00Z');
    expect(d1?.title_bg).toBe('Заглавие 1'); // untouched
    expect(JSON.parse(d1?.tags_json ?? '[]')).toEqual(['t']); // untouched
  });

  it('counts per-dataset failures without aborting the rest', async () => {
    const client: DatasetDetailFetcher = {
      getDatasetDetails: async (uri) => {
        if (uri === 'ds-1') throw new Error('boom');
        return { data: { created_at: null, updated_at: '2026-06-05T00:00:00Z' } };
      },
    };
    const res = await refreshMetadata({ repo: s.repo, client });
    expect(res.total).toBe(2);
    expect(res.refreshed).toBe(1);
    expect(res.failed).toBe(1);
    expect(s.repo.get('ds-2')?.metadata_modified).toBe('2026-06-05T00:00:00Z');
    expect(s.repo.get('ds-1')?.metadata_modified).toBeNull(); // failed → untouched
  });

  it('treats absent updated_at / data as null (no crash)', async () => {
    const client: DatasetDetailFetcher = { getDatasetDetails: async () => ({ data: {} }) };
    const res = await refreshMetadata({ repo: s.repo, client });
    expect(res.refreshed).toBe(2);
    expect(s.repo.get('ds-1')?.metadata_modified).toBeNull();
  });

  it('honors an explicit datasetIds subset', async () => {
    const client: DatasetDetailFetcher = {
      getDatasetDetails: async () => ({ data: { updated_at: '2026-06-09T00:00:00Z' } }),
    };
    const res = await refreshMetadata({ repo: s.repo, client, datasetIds: ['ds-2'] });
    expect(res.total).toBe(1);
    expect(s.repo.get('ds-2')?.metadata_modified).toBe('2026-06-09T00:00:00Z');
    expect(s.repo.get('ds-1')?.metadata_modified).toBeNull();
  });
});
