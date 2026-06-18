// Performance guard (T071, closes G2 / SC-003 / SC-010): list + region aggregation over a
// several-hundred-dataset corpus must respond well within the 2s budget. The threshold is generous
// to avoid CI flakiness while still catching gross regressions (e.g. an accidental N^2 path).

import type { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { UsersRepo } from '../../../src/store/repos/users.ts';
import { type AppContext, createApp } from '../src/app.ts';
import { ReadBridge } from '../src/read-bridge.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const N = 600;
const BUDGET_MS = 2000;
const OBLASTS = [
  'geo:bg-oblast-sofia-grad',
  'geo:bg-oblast-plovdiv',
  'geo:bg-oblast-varna',
  'geo:bg-oblast-ruse',
];

describe('performance', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let storeRoot: string;

  beforeAll(async () => {
    // Isolated store (beforeAll precedes the global beforeEach that sets __TEST_TMP_DIR__).
    storeRoot = mkdtempSync(join(tmpdir(), 'danni-perf-'));
    db = openDb({ storeRoot, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
    const ds = new DatasetsRepo(db);
    const ents = new EntitiesRepo(db);
    for (const o of OBLASTS) ents.upsert({ id: o, kind: 'geographic_unit', canonicalLabelBg: o });
    for (let i = 0; i < N; i++) {
      const id = `d${i}`;
      ds.upsert({
        id,
        slug: id,
        titleBg: `Набор ${i}`,
        tags: [`таг${i % 20}`],
        groups: [],
        sourceUrl: `https://x/${id}`,
      });
      const o = OBLASTS[i % OBLASTS.length];
      if (o) ents.attach({ datasetId: id, entityId: o, extractor: 'g', confidence: 0.7 });
    }
    const embedder = new LocalOnnxEmbedder({ dimension: 8 });
    await runIndex({ db, embedder });
    app = createApp({
      bridge: new ReadBridge({ db, storeRoot, embedder, freshnessSloSeconds: 86400 }),
      crosswalk: new Crosswalk(loadCrosswalk()),
      users: new UsersRepo(db),
      health: () => ({
        lastSyncedAt: '2026-06-01T00:00:00Z',
        isStale: false,
        defaultProvider: 'absent',
      }),
    } satisfies AppContext);
  });
  afterAll(() => {
    db.close();
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it(`answers /api/datasets over ${N} datasets within ${BUDGET_MS}ms`, async () => {
    const start = performance.now();
    const res = await app.request('/api/datasets?limit=200');
    const body = (await res.json()) as { total: number };
    const elapsed = performance.now() - start;
    expect(body.total).toBe(N);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it(`answers /api/regions aggregation within ${BUDGET_MS}ms`, async () => {
    const start = performance.now();
    const res = await app.request('/api/regions?level=oblast');
    const body = (await res.json()) as { regions: { datasetCount: number }[] };
    const elapsed = performance.now() - start;
    expect(body.regions.some((r) => r.datasetCount > 0)).toBe(true);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
