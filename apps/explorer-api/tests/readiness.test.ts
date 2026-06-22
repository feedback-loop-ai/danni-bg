// Readiness probe (spec 030) — hermetic. Gates on DB reachable + migrations current; provider is
// informational only. Drives a real /readyz through createApp to assert the 200/503 contract.

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Crosswalk } from '../../../packages/geo-boundaries/src/crosswalk.ts';
import { loadCrosswalk } from '../../../packages/geo-boundaries/src/load.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { PlatformSettingsRepo } from '../../../src/store/repos/platform-settings.ts';
import { UsersRepo } from '../../../src/store/repos/users.ts';
import { LLM_SETTING_KEY } from '../src/admin/settings-schema.ts';
import { type AppContext, createApp } from '../src/app.ts';
import type { ReadBridge } from '../src/read-bridge.ts';
import { checkReadiness } from '../src/readiness.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

describe('checkReadiness (spec 030)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('ready when the DB is reachable and all migrations are applied', () => {
    const db = new Database(':memory:');
    runMigrations(db, MIGRATIONS);
    const r = checkReadiness({ db, migrationsDir: MIGRATIONS });
    expect(r.ready).toBe(true);
    expect(r.checks.db).toBe(true);
    expect(r.checks.migrationsCurrent).toBe(true);
    expect(r.pending).toBeUndefined();
  });

  it('NOT ready and lists pending when a migration has not been applied', () => {
    // A fresh DB against the real migrations dir: nothing applied yet → every migration is pending.
    const db = new Database(':memory:');
    const r = checkReadiness({ db, migrationsDir: MIGRATIONS });
    expect(r.ready).toBe(false);
    expect(r.checks.migrationsCurrent).toBe(false);
    expect((r.pending ?? []).length).toBeGreaterThan(0);
    expect(r.pending).toContain('1_core');
  });

  it('provider check is informational and does not gate readiness', () => {
    const db = new Database(':memory:');
    runMigrations(db, MIGRATIONS);
    const settings = new PlatformSettingsRepo(db);
    // No provider configured (and no env) → providerConfigured false, but still ready.
    const noProv = checkReadiness({ db, migrationsDir: MIGRATIONS, settings, env: {} });
    expect(noProv.checks.providerConfigured).toBe(false);
    expect(noProv.ready).toBe(true);

    settings.set(LLM_SETTING_KEY, {
      kind: 'openai-compatible',
      model: 'm',
      baseUrl: 'http://x',
      apiKey: 'k',
    });
    const withProv = checkReadiness({ db, migrationsDir: MIGRATIONS, settings, env: {} });
    expect(withProv.checks.providerConfigured).toBe(true);
  });

  it('migrationsCurrent is false when the dir has an unapplied migration beyond the DB', () => {
    const db = new Database(':memory:');
    runMigrations(db, MIGRATIONS);
    // Point at a copy-free temp dir holding one extra, never-applied migration.
    const dir = mkdtempSync(join(tmpdir(), 'danni-mig-'));
    dirs.push(dir);
    writeFileSync(join(dir, '999_future.sql'), 'CREATE TABLE future_t (id TEXT);');
    const r = checkReadiness({ db, migrationsDir: dir });
    expect(r.checks.migrationsCurrent).toBe(false);
    expect(r.pending).toContain('999_future');
  });

  it('/readyz returns 200 when ready, 503 when a migration is pending', async () => {
    const ready = new Database(':memory:');
    runMigrations(ready, MIGRATIONS);
    const mk = (db: Database): AppContext => ({
      bridge: {} as ReadBridge,
      crosswalk: new Crosswalk(loadCrosswalk()),
      health: () => ({ lastSyncedAt: null, isStale: true, defaultProvider: 'absent' }),
      readiness: () => checkReadiness({ db, migrationsDir: MIGRATIONS }),
      users: new UsersRepo(db),
    });
    expect((await createApp(mk(ready)).request('/readyz')).status).toBe(200);

    const fresh = new Database(':memory:'); // nothing migrated → not ready
    const res = await createApp(mk(fresh)).request('/readyz');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { ready: boolean }).ready).toBe(false);
  });
});
