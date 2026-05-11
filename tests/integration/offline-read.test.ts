import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeView } from '../../src/cli/mirror-info.ts';
import { LocalOnnxEmbedder } from '../../src/index/embedders/local-onnx.ts';
import { search } from '../../src/index/query.ts';
import { runIndex } from '../../src/index/run-index.ts';
import { openDb } from '../../src/store/db.ts';
import { runMigrations } from '../../src/store/migrate.ts';
import { DatasetsRepo } from '../../src/store/repos/datasets.ts';
import { OrganizationsRepo } from '../../src/store/repos/organizations.ts';
import { SyncRunsRepo } from '../../src/store/repos/sync-runs.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('integration.offline-read (SC-006)', () => {
  let db: Database;
  let storeRoot: string;
  beforeEach(() => {
    storeRoot = globalThis.__TEST_TMP_DIR__;
    db = openDb({ storeRoot, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
    new OrganizationsRepo(db).upsert({
      id: 'p1',
      slug: 'p1',
      titleBg: 'Столична община',
      sourceUrl: 'https://x/p1',
    });
    new DatasetsRepo(db).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Бюджет',
      publisherId: 'p1',
      tags: [],
      groups: [],
      sourceUrl: 'https://x/d1',
    });
    new SyncRunsRepo(db).create({
      id: 'r1',
      trigger: 'manual',
      scopeFilterJson: '{}',
    });
  });
  afterEach(() => {
    db.close();
  });

  it('read paths succeed without any portal HTTP egress', async () => {
    // Install a fetch stub that throws on any data.egov.bg URL.
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('data.egov.bg')) {
        throw new Error(`offline-read test: portal egress to ${url} is forbidden`);
      }
      return new Response(null, { status: 404 }) as unknown as Response;
    }) as unknown as typeof fetch;

    try {
      const view = composeView(db, 'd1', 86400);
      expect(view.datasetId).toBe('d1');
      const embedder = new LocalOnnxEmbedder({ dimension: 8 });
      await runIndex({ db, embedder });
      const out = await search({ db, embedder, query: 'бюджет' });
      expect(out.length).toBeGreaterThan(0);
      const runs = new SyncRunsRepo(db).recent(10);
      expect(runs.length).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
