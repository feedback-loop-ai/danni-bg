// Reachability invariant (T072, closes G3 / SC-009): 100% of mirror datasets are reachable through
// either a region (a geo entity that resolves to a crosswalk-mapped unit) or the national /
// non-georeferenced grouping — none are silently dropped off the map.

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
import { type AppContext, createApp } from '../src/app.ts';
import { ReadBridge } from '../src/read-bridge.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('dataset reachability (SC-009)', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    db = openDb({ storeRoot, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
    const ds = new DatasetsRepo(db);
    // geo1 → mapped oblast; geo2 → mapped municipality; nat1 → no geo (national grouping)
    ds.upsert({
      id: 'geo1',
      slug: 'geo1',
      titleBg: 'Регионален',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/geo1',
    });
    ds.upsert({
      id: 'geo2',
      slug: 'geo2',
      titleBg: 'Общински',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/geo2',
    });
    ds.upsert({
      id: 'nat1',
      slug: 'nat1',
      titleBg: 'Национален регистър',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/nat1',
    });
    const ents = new EntitiesRepo(db);
    ents.upsert({ id: 'geo:bg-oblast-ruse', kind: 'geographic_unit', canonicalLabelBg: 'Русе' });
    ents.upsert({
      id: 'geo:bg-municipality-sofia',
      kind: 'geographic_unit',
      canonicalLabelBg: 'Столична община',
    });
    ents.attach({
      datasetId: 'geo1',
      entityId: 'geo:bg-oblast-ruse',
      extractor: 'g',
      confidence: 0.8,
    });
    ents.attach({
      datasetId: 'geo2',
      entityId: 'geo:bg-municipality-sofia',
      extractor: 'g',
      confidence: 0.8,
    });
    const embedder = new LocalOnnxEmbedder({ dimension: 8 });
    await runIndex({ db, embedder });
    app = createApp({
      bridge: new ReadBridge({ db, storeRoot, embedder, freshnessSloSeconds: 86400 }),
      crosswalk: new Crosswalk(loadCrosswalk()),
      health: () => ({
        lastSyncedAt: '2026-06-01T00:00:00Z',
        isStale: false,
        defaultProvider: 'absent',
      }),
    } satisfies AppContext);
  });
  afterEach(() => db.close());

  it('every dataset is reachable via a region or the national grouping', async () => {
    const all = (await (await app.request('/api/datasets?limit=200')).json()) as {
      datasets: { datasetId: string }[];
    };
    const allIds = new Set(all.datasets.map((d) => d.datasetId));
    expect(allIds.size).toBe(3);

    const reachable = new Set<string>();
    // Region-reachable: walk both crosswalk levels.
    for (const level of ['oblast', 'municipality'] as const) {
      const regions = (await (await app.request(`/api/regions?level=${level}`)).json()) as {
        regions: { entityId: string | null }[];
      };
      for (const r of regions.regions) {
        if (!r.entityId) continue;
        const rd = (await (
          await app.request(`/api/regions/${encodeURIComponent(r.entityId)}`)
        ).json()) as { datasets: { datasetId: string }[] };
        for (const d of rd.datasets) reachable.add(d.datasetId);
      }
    }
    // National-reachable.
    const national = (await (await app.request('/api/national')).json()) as {
      datasets: { datasetId: string }[];
    };
    for (const d of national.datasets) reachable.add(d.datasetId);

    const unreachable = [...allIds].filter((id) => !reachable.has(id));
    expect(unreachable).toEqual([]);
    expect(national.datasets.map((d) => d.datasetId)).toEqual(['nat1']);
  });
});
