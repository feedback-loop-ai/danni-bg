// Stale-degradation coverage (T070, closes U1 / Constitution IV). Data routes must serve the
// last-synced corpus with honest `is_stale` flags rather than dropping stale datasets, and freshness
// filtering must work on the list endpoint.

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
import { UsersRepo } from '../../../src/store/repos/users.ts';
import { type AppContext, createApp } from '../src/app.ts';
import { ReadBridge } from '../src/read-bridge.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('stale degradation on data routes', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    db = openDb({ storeRoot, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
    const ds = new DatasetsRepo(db);
    ds.upsert({
      id: 'fresh1',
      slug: 'fresh1',
      titleBg: 'Свеж',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/fresh1',
    });
    // A dataset last synced long ago → isStale against the 1-day SLO, but MUST still be served.
    ds.upsert({
      id: 'stale1',
      slug: 'stale1',
      titleBg: 'Остарял',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/stale1',
      now: '2000-01-01T00:00:00Z',
    });
    const embedder = new LocalOnnxEmbedder({ dimension: 8 });
    await runIndex({ db, embedder });
    const ctx: AppContext = {
      bridge: new ReadBridge({ db, storeRoot, embedder, freshnessSloSeconds: 86400 }),
      crosswalk: new Crosswalk(loadCrosswalk()),
      health: () => ({
        lastSyncedAt: '2000-01-01T00:00:00Z',
        isStale: true,
        defaultProvider: 'configured',
      }),
      users: new UsersRepo(db),
    };
    app = createApp(ctx);
  });
  afterEach(() => db.close());

  it('serves stale datasets with is_stale=true rather than dropping them', async () => {
    const res = await app.request('/api/datasets');
    const body = (await res.json()) as {
      total: number;
      datasets: { datasetId: string; freshness: { isStale: boolean } }[];
    };
    expect(body.total).toBe(2);
    const stale = body.datasets.find((d) => d.datasetId === 'stale1');
    expect(stale?.freshness.isStale).toBe(true);
    const fresh = body.datasets.find((d) => d.datasetId === 'fresh1');
    expect(fresh?.freshness.isStale).toBe(false);
  });

  it('filters by freshness state', async () => {
    const freshOnly = (await (await app.request('/api/datasets?freshness=fresh')).json()) as {
      datasets: { datasetId: string }[];
    };
    expect(freshOnly.datasets.map((d) => d.datasetId)).toEqual(['fresh1']);
    const staleOnly = (await (await app.request('/api/datasets?freshness=stale')).json()) as {
      datasets: { datasetId: string }[];
    };
    expect(staleOnly.datasets.map((d) => d.datasetId)).toEqual(['stale1']);
  });

  it('detail payload carries the freshness block', async () => {
    const detail = (await (await app.request('/api/datasets/stale1')).json()) as {
      freshness: { isStale: boolean; lastSyncedAt: string };
    };
    expect(detail.freshness.isStale).toBe(true);
    expect(detail.freshness.lastSyncedAt).toBe('2000-01-01T00:00:00Z');
  });

  it('/healthz reports degraded when the corpus is stale', async () => {
    const body = (await (await app.request('/healthz')).json()) as {
      status: string;
      isStale: boolean;
    };
    expect(body.status).toBe('degraded');
    expect(body.isStale).toBe(true);
  });
});
