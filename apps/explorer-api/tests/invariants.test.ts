// Cross-cutting payload invariants (T065, closes G-locale/freshness): Cyrillic round-trips byte-exact
// (Constitution X) and every dataset/detail payload carries a complete freshness block
// (Constitution IX). No authoritative Bulgarian field is rewritten.

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
import { OrganizationsRepo } from '../../../src/store/repos/organizations.ts';
import { UsersRepo } from '../../../src/store/repos/users.ts';
import { type AppContext, createApp } from '../src/app.ts';
import { ReadBridge } from '../src/read-bridge.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CYRILLIC_TITLE = 'Качество на атмосферния въздух — гр. София (ж.к. „Дружба“)';
const FRESHNESS_KEYS = [
  'lastSyncedAt',
  'sourceLastModified',
  'sourceEtagOrHash',
  'isStale',
  'freshnessSloSeconds',
];

describe('payload invariants', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    db = openDb({ storeRoot, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
    new OrganizationsRepo(db).upsert({
      id: 'p1',
      slug: 'p1',
      titleBg: 'Изпълнителна агенция по околна среда',
      sourceUrl: 'https://x/p1',
    });
    new DatasetsRepo(db).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: CYRILLIC_TITLE,
      publisherId: 'p1',
      tags: ['въздух'],
      groups: [],
      sourceUrl: 'https://data.egov.bg/d1',
    });
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
  afterEach(() => db.close());

  it('round-trips Cyrillic byte-exact through the list + detail payloads', async () => {
    const list = (await (await app.request('/api/datasets')).json()) as {
      datasets: { titleBg: string }[];
    };
    expect(list.datasets[0]?.titleBg).toBe(CYRILLIC_TITLE);
    const detail = (await (await app.request('/api/datasets/d1')).json()) as {
      titleBg: string;
      publisher: { titleBg: string } | null;
    };
    expect(detail.titleBg).toBe(CYRILLIC_TITLE);
    expect(detail.publisher?.titleBg).toBe('Изпълнителна агенция по околна среда');
  });

  it('every dataset payload carries a complete freshness block', async () => {
    const list = (await (await app.request('/api/datasets')).json()) as {
      datasets: { freshness: Record<string, unknown> }[];
    };
    for (const d of list.datasets) {
      for (const key of FRESHNESS_KEYS) expect(d.freshness).toHaveProperty(key);
    }
    const detail = (await (await app.request('/api/datasets/d1')).json()) as {
      freshness: Record<string, unknown>;
    };
    for (const key of FRESHNESS_KEYS) expect(detail.freshness).toHaveProperty(key);
  });
});
