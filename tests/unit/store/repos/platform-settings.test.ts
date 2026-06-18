import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { PlatformSettingsRepo } from '../../../../src/store/repos/platform-settings.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

function open(): Database {
  const d = new Database(':memory:');
  runMigrations(d, join(ROOT, 'migrations'));
  return d;
}

describe('store.repos.platform-settings', () => {
  let db: Database;
  let repo: PlatformSettingsRepo;
  beforeEach(() => {
    db = open();
    repo = new PlatformSettingsRepo(db);
  });
  afterEach(() => db.close());

  it('get returns null when a key is unset', () => {
    expect(repo.get('missing')).toBeNull();
  });

  it('set then get round-trips JSON, including Cyrillic values', () => {
    repo.set('k', { a: 1, bg: 'Данни за въздуха' }, 'admin@example.com');
    expect(repo.get('k')).toEqual({ a: 1, bg: 'Данни за въздуха' });
  });

  it('set upserts (overwrites) an existing key', () => {
    repo.set('k', { v: 1 });
    repo.set('k', { v: 2 });
    expect(repo.get('k')).toEqual({ v: 2 });
  });

  it('all returns every key parsed', () => {
    repo.set('a', 1);
    repo.set('b', 'two');
    expect(repo.all()).toEqual({ a: 1, b: 'two' });
  });
});
