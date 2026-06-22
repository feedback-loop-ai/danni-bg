import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../migrate.ts';
import { GLOBAL_SETTINGS, PlatformSettingsRepo } from './platform-settings.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function setup() {
  const db = new Database(':memory:');
  runMigrations(db, join(ROOT, 'migrations'));
  return { db, settings: new PlatformSettingsRepo(db) };
}

describe('PlatformSettingsRepo (tenant-scoped, spec 029)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('reads/writes the global row by default (backward compatible)', () => {
    expect(s.settings.get('llm.default')).toBeNull();
    s.settings.set('llm.default', { model: 'g' }, 'admin@x');
    expect(s.settings.get('llm.default')).toEqual({ model: 'g' });
    expect(s.settings.all()).toEqual({ 'llm.default': { model: 'g' } });
  });

  it('a tenant value overrides the global; absent → falls back to global', () => {
    s.settings.set('llm.default', { model: 'global' }, 'root');
    s.settings.set('llm.default', { model: 'acme' }, 'owner', undefined, 'acme');
    // Acme sees its own value; a tenant with no override sees the global fallback.
    expect(s.settings.get('llm.default', 'acme')).toEqual({ model: 'acme' });
    expect(s.settings.get('llm.default', 'globex')).toEqual({ model: 'global' });
    expect(s.settings.get('llm.default', GLOBAL_SETTINGS)).toEqual({ model: 'global' });
  });

  it('a tenant with no global fallback and no own value reads null', () => {
    expect(s.settings.get('toggles', 'acme')).toBeNull();
  });
});
