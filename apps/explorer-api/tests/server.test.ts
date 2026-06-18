import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../../src/store/db.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { PlatformSettingsRepo } from '../../../src/store/repos/platform-settings.ts';
import { LLM_SETTING_KEY } from '../src/admin/settings-schema.ts';
import { buildHealth } from '../src/server.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('buildHealth', () => {
  let db: Database;
  let settings: PlatformSettingsRepo;
  let savedProvider: string | undefined;
  let savedModel: string | undefined;

  beforeEach(() => {
    db = openDb({ storeRoot: globalThis.__TEST_TMP_DIR__, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
    settings = new PlatformSettingsRepo(db);
    // Isolate from any ambient EXPLORER_DEFAULT_* (a local .env seeds DeepSeek).
    savedProvider = process.env.EXPLORER_DEFAULT_PROVIDER;
    savedModel = process.env.EXPLORER_DEFAULT_MODEL;
    process.env.EXPLORER_DEFAULT_PROVIDER = undefined as unknown as string;
    delete process.env.EXPLORER_DEFAULT_PROVIDER;
    delete process.env.EXPLORER_DEFAULT_MODEL;
  });
  afterEach(() => {
    db.close();
    if (savedProvider === undefined) delete process.env.EXPLORER_DEFAULT_PROVIDER;
    else process.env.EXPLORER_DEFAULT_PROVIDER = savedProvider;
    if (savedModel === undefined) delete process.env.EXPLORER_DEFAULT_MODEL;
    else process.env.EXPLORER_DEFAULT_MODEL = savedModel;
  });

  it('is stale with no datasets and reports the provider as absent when nothing is configured', () => {
    const h = buildHealth(db, 86400, settings);
    expect(h.lastSyncedAt).toBeNull();
    expect(h.isStale).toBe(true);
    expect(h.defaultProvider).toBe('absent');
  });

  it('reports configured from the env seed (provider + model)', () => {
    process.env.EXPLORER_DEFAULT_PROVIDER = 'openai-compatible';
    process.env.EXPLORER_DEFAULT_MODEL = 'm';
    expect(buildHealth(db, 86400, settings).defaultProvider).toBe('configured');
  });

  it('reports configured from the settings store even with no env', () => {
    settings.set(LLM_SETTING_KEY, {
      kind: 'openai-compatible',
      model: 'm',
      baseUrl: null,
      apiKey: null,
    });
    expect(buildHealth(db, 86400, settings).defaultProvider).toBe('configured');
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
    const h = buildHealth(db, 86400, settings);
    expect(h.lastSyncedAt).not.toBeNull();
    expect(h.isStale).toBe(false);
  });
});
