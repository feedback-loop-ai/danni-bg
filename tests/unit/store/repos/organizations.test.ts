import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { OrganizationsRepo } from '../../../../src/store/repos/organizations.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function db(): Database {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  return d;
}

describe('store.repos.organizations', () => {
  let database: Database;
  beforeEach(() => {
    database = db();
  });
  afterEach(() => {
    database.close();
  });

  it('inserts and re-reads', () => {
    const repo = new OrganizationsRepo(database);
    const row = repo.upsert({
      id: 'o1',
      slug: 'org-1',
      titleBg: 'Столична община',
      sourceUrl: 'https://example.org/o1',
    });
    expect(row.title_bg).toBe('Столична община');
    expect(repo.get('o1')?.slug).toBe('org-1');
  });

  it('updates title on existing org', () => {
    const repo = new OrganizationsRepo(database);
    repo.upsert({
      id: 'o1',
      slug: 'org-1',
      titleBg: 'A',
      sourceUrl: 'https://x/o1',
    });
    repo.upsert({
      id: 'o1',
      slug: 'org-1-updated',
      titleBg: 'B',
      descriptionBg: 'desc',
      sourceUrl: 'https://x/o1-updated',
    });
    const row = repo.get('o1');
    expect(row?.title_bg).toBe('B');
    expect(row?.slug).toBe('org-1-updated');
    expect(row?.description_bg).toBe('desc');
  });

  it('returns null for unknown id', () => {
    const repo = new OrganizationsRepo(database);
    expect(repo.get('missing')).toBeNull();
  });
});
