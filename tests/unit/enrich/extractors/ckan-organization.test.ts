import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CkanOrganizationExtractor } from '../../../../src/enrich/extractors/ckan-organization.ts';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { type DatasetRow, DatasetsRepo } from '../../../../src/store/repos/datasets.ts';
import { OrganizationsRepo } from '../../../../src/store/repos/organizations.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function setup(): { db: Database; org: OrganizationsRepo; ds: DatasetsRepo } {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  return { db: d, org: new OrganizationsRepo(d), ds: new DatasetsRepo(d) };
}

function fakeDataset(publisherId: string | null = null): DatasetRow {
  return {
    id: 'd1',
    slug: 'd1',
    title_bg: 'A',
    description_bg: null,
    publisher_id: publisherId,
    license_id: null,
    tags_json: '[]',
    groups_json: '[]',
    source_url: 'https://x/d1',
    metadata_created: null,
    metadata_modified: null,
    first_seen_at: '2026-05-08T00:00:00Z',
    last_synced_at: '2026-05-08T00:00:00Z',
    source_etag_or_hash: null,
    lifecycle_state: 'active',
    lifecycle_changed_at: null,
    withdrawn_reason: null,
  };
}

describe('enrich.extractors.ckan-organization', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('emits an organization candidate when dataset has a publisher', async () => {
    s.org.upsert({ id: 'p1', slug: 'p1', titleBg: 'Столична община', sourceUrl: 'https://x/p1' });
    const ex = new CkanOrganizationExtractor(s.org);
    const candidates = await ex.extract({ dataset: fakeDataset('p1'), resources: [] });
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.id).toBe('org:p1');
    expect(candidates[0]?.kind).toBe('organization');
    expect(candidates[0]?.confidence).toBe(1.0);
  });

  it('returns empty when dataset has no publisher', async () => {
    const ex = new CkanOrganizationExtractor(s.org);
    expect((await ex.extract({ dataset: fakeDataset(null), resources: [] })).length).toBe(0);
  });

  it('returns empty when org missing in DB', async () => {
    const ex = new CkanOrganizationExtractor(s.org);
    expect((await ex.extract({ dataset: fakeDataset('missing'), resources: [] })).length).toBe(0);
  });
});
