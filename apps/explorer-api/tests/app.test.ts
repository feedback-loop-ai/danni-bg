// Route-level contract tests for the explorer API against a seeded in-memory store
// (covers T016 healthz, T019 regions, T020 dataset detail, T032 datasets list, T033 facets,
// T073 no-auth). Datasets are seeded via the existing repos; the embedder is the deterministic stub.

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Crosswalk } from '../../../packages/geo-boundaries/src/crosswalk.ts';
import { loadCrosswalk } from '../../../packages/geo-boundaries/src/load.ts';
import { LocalOnnxEmbedder } from '../../../src/index/embedders/local-onnx.ts';
import { runIndex } from '../../../src/index/run-index.ts';
import { openDb } from '../../../src/store/db.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { EntitiesRepo } from '../../../src/store/repos/entities.ts';
import { OrganizationsRepo } from '../../../src/store/repos/organizations.ts';
import { ResourcesRepo } from '../../../src/store/repos/resources.ts';
import { type AppContext, createApp } from '../src/app.ts';
import { ReadBridge } from '../src/read-bridge.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function seed(db: Database): void {
  const orgs = new OrganizationsRepo(db);
  orgs.upsert({ id: 'p1', slug: 'p1', titleBg: 'Столична община', sourceUrl: 'https://x/p1' });
  const ds = new DatasetsRepo(db);
  ds.upsert({
    id: 'd1',
    slug: 'd1',
    titleBg: 'Качество на въздуха',
    publisherId: 'p1',
    tags: ['въздух'],
    groups: [],
    sourceUrl: 'https://data.egov.bg/d1',
  });
  ds.upsert({
    id: 'd2',
    slug: 'd2',
    titleBg: 'Бюджет',
    publisherId: 'p1',
    tags: ['бюджет'],
    groups: [],
    sourceUrl: 'https://data.egov.bg/d2',
  });
  new ResourcesRepo(db).upsert({
    id: 'r1',
    datasetId: 'd1',
    sourceUrl: 'https://data.egov.bg/d1/r1',
    name: 'rows',
  });
  const ents = new EntitiesRepo(db);
  ents.upsert({
    id: 'geo:bg-oblast-sofia-grad',
    kind: 'geographic_unit',
    canonicalLabelBg: 'София (град)',
  });
  ents.attach({
    datasetId: 'd1',
    entityId: 'geo:bg-oblast-sofia-grad',
    extractor: 'gaz',
    confidence: 0.9,
  });
  ents.attach({
    datasetId: 'd2',
    entityId: 'geo:bg-oblast-sofia-grad',
    extractor: 'gaz',
    confidence: 0.6,
  });
}

describe('explorer API routes', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    db = openDb({ storeRoot, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
    seed(db);
    const embedder = new LocalOnnxEmbedder({ dimension: 8 });
    await runIndex({ db, embedder });
    const bridge = new ReadBridge({ db, storeRoot, embedder, freshnessSloSeconds: 86400 });
    const ctx: AppContext = {
      bridge,
      crosswalk: new Crosswalk(loadCrosswalk()),
      health: () => ({
        lastSyncedAt: '2026-06-01T00:00:00Z',
        isStale: false,
        defaultProvider: 'absent',
      }),
    };
    app = createApp(ctx);
  });
  afterEach(() => db.close());

  it('GET /healthz reports degraded when the default provider is absent', async () => {
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; components: { defaultProvider: string } };
    expect(body.status).toBe('degraded');
    expect(body.components.defaultProvider).toBe('absent');
  });

  it('GET /api/datasets lists all, no auth header required', async () => {
    const res = await app.request('/api/datasets');
    const body = (await res.json()) as { total: number; datasets: { datasetId: string }[] };
    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
  });

  it('GET /api/datasets filters by tag (AND)', async () => {
    const res = await app.request('/api/datasets?tags=въздух');
    const body = (await res.json()) as { total: number; datasets: { datasetId: string }[] };
    expect(body.datasets.map((d) => d.datasetId)).toEqual(['d1']);
  });

  it('GET /api/datasets with q runs ranked search', async () => {
    const res = await app.request(`/api/datasets?q=${encodeURIComponent('въздух')}`);
    const body = (await res.json()) as { datasets: { datasetId: string }[] };
    expect(body.datasets.some((d) => d.datasetId === 'd1')).toBe(true);
  });

  it('GET /api/datasets/:id returns detail; unknown id 404', async () => {
    const ok = await app.request('/api/datasets/d1');
    expect(ok.status).toBe(200);
    const d = (await ok.json()) as { titleBg: string; geoEntityIds: string[] };
    expect(d.titleBg).toBe('Качество на въздуха');
    expect(d.geoEntityIds).toContain('geo:bg-oblast-sofia-grad');
    const miss = await app.request('/api/datasets/nope');
    expect(miss.status).toBe(404);
  });

  it('GET /api/regions aggregates per oblast with deduped counts', async () => {
    const res = await app.request('/api/regions?level=oblast');
    const body = (await res.json()) as {
      regions: { entityId: string | null; datasetCount: number; maxConfidence: number }[];
    };
    const sofia = body.regions.find((r) => r.entityId === 'geo:bg-oblast-sofia-grad');
    expect(sofia?.datasetCount).toBe(2);
    expect(sofia?.maxConfidence).toBe(0.9);
  });

  it('GET /api/regions/:id lists datasets; empty + 404 cases', async () => {
    const res = await app.request('/api/regions/geo:bg-oblast-sofia-grad');
    const body = (await res.json()) as { total: number; region: { hasData: boolean } };
    expect(body.total).toBe(2);
    expect(body.region.hasData).toBe(true);

    const empty = await app.request('/api/regions/geo:bg-oblast-varna');
    const eb = (await empty.json()) as { total: number; datasets: unknown[] };
    expect(empty.status).toBe(200);
    expect(eb.total).toBe(0);
    expect(eb.datasets).toEqual([]);

    const bad = await app.request('/api/regions/geo:bg-oblast-unmapped-xyz');
    expect(bad.status).toBe(404);
  });

  it('GET /api/facets returns in-scope tag/publisher/freshness counts', async () => {
    const res = await app.request('/api/facets');
    const body = (await res.json()) as {
      tags: { id: string }[];
      publishers: { count: number }[];
      freshnessBuckets: { id: string; count: number }[];
    };
    expect(body.tags.map((t) => t.id).sort()).toEqual(['бюджет', 'въздух']);
    expect(body.publishers[0]?.count).toBe(2);
    expect(body.freshnessBuckets.find((b) => b.id === 'fresh')?.count).toBe(2);
  });

  it('GET resource rows returns content; missing resource 404', async () => {
    const ok = await app.request('/api/datasets/d1/resources/r1/rows?limit=10');
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { datasetId: string; total: number };
    expect(body.datasetId).toBe('d1');
    const miss = await app.request('/api/datasets/d1/resources/nope/rows');
    expect(miss.status).toBe(404);
  });

  it('maps invalid query params to a 400 bad_request envelope', async () => {
    const res = await app.request('/api/datasets?freshness=bogus');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('bad_request');
  });

  it('maps an unexpected handler error to a 500 internal envelope', async () => {
    const boom: AppContext = {
      bridge: {
        listAllIds: () => {
          throw new Error('boom');
        },
      } as unknown as ReadBridge,
      crosswalk: new Crosswalk(loadCrosswalk()),
      health: () => ({ lastSyncedAt: null, isStale: true, defaultProvider: 'absent' }),
    };
    const res = await createApp(boom).request('/api/facets');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('internal');
  });
});
