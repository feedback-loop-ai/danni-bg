import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../../src/store/db.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { buildHealth } from '../src/server.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('buildHealth', () => {
  let db: Database;
  beforeEach(() => {
    db = openDb({ storeRoot: globalThis.__TEST_TMP_DIR__, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
  });
  afterEach(() => db.close());

  it('is stale with no datasets and reflects the provider env', () => {
    const prev = process.env.EXPLORER_DEFAULT_PROVIDER;
    process.env.EXPLORER_DEFAULT_PROVIDER = '';
    const h = buildHealth(db, 86400);
    expect(h.lastSyncedAt).toBeNull();
    expect(h.isStale).toBe(true);
    expect(h.defaultProvider).toBe('absent');
    process.env.EXPLORER_DEFAULT_PROVIDER = 'openai-compatible';
    expect(buildHealth(db, 86400).defaultProvider).toBe('configured');
    if (prev === undefined) delete process.env.EXPLORER_DEFAULT_PROVIDER;
    else process.env.EXPLORER_DEFAULT_PROVIDER = prev;
  });

  it('reports a recent sync as fresh', () => {
    new DatasetsRepo(db).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Т',
      tags: [],
      groups: [],
      sourceUrl: 'u',
    });
    const h = buildHealth(db, 86400);
    expect(h.lastSyncedAt).not.toBeNull();
    expect(h.isStale).toBe(false);
  });
});
