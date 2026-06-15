import { describe, expect, it } from 'bun:test';
import { BgAdminPublisherExtractor } from '../../../../src/enrich/extractors/bg-admin-publisher.ts';
import type { DatasetRow } from '../../../../src/store/repos/datasets.ts';
import type {
  OrganizationRow,
  OrganizationsRepo,
} from '../../../../src/store/repos/organizations.ts';

function fakeDataset(publisherId: string | null, title = 'Обществени поръчки 2024'): DatasetRow {
  return {
    id: 'd1',
    slug: 'd1',
    title_bg: title,
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

/** Minimal stub: the extractor only ever calls `orgs.get(id)`. */
function fakeOrgs(byId: Record<string, string>): OrganizationsRepo {
  return {
    get(id: string): OrganizationRow | undefined {
      const title = byId[id];
      if (title === undefined) return undefined;
      return {
        id,
        slug: id,
        title_bg: title,
        description_bg: null,
        source_url: `https://x/org/${id}`,
        first_seen_at: '2026-05-08T00:00:00Z',
        last_synced_at: '2026-05-08T00:00:00Z',
      };
    },
  } as unknown as OrganizationsRepo;
}

describe('enrich.extractors.bg-admin-publisher', () => {
  it('infers the place from a municipal publisher whose title names it', async () => {
    const ex = new BgAdminPublisherExtractor(fakeOrgs({ 'org-burgas': 'Община Бургас' }));
    const out = await ex.extract({ dataset: fakeDataset('org-burgas'), resources: [] });
    const burgas = out.find((c) => c.id === 'geo:bg-municipality-burgas');
    expect(burgas).toBeDefined();
    expect(burgas?.kind).toBe('geographic_unit');
    expect(burgas?.evidence.source).toBe('publisher');
    expect(burgas?.evidence.publisherId).toBe('org-burgas');
  });

  it('emits below in-content confidence (≤ 0.7), so a title match outranks it', async () => {
    const ex = new BgAdminPublisherExtractor(fakeOrgs({ 'org-burgas': 'Община Бургас' }));
    const out = await ex.extract({ dataset: fakeDataset('org-burgas'), resources: [] });
    for (const c of out) expect(c.confidence).toBeLessThanOrEqual(0.7);
    // The in-content gazetteer extractor uses 0.95/0.75 — strictly higher than this extractor.
    expect(Math.max(...out.map((c) => c.confidence))).toBeLessThan(0.75);
  });

  it('returns nothing for a national publisher that names no place', async () => {
    const ex = new BgAdminPublisherExtractor(fakeOrgs({ 'org-mf': 'Министерство на финансите' }));
    const out = await ex.extract({ dataset: fakeDataset('org-mf'), resources: [] });
    expect(out).toEqual([]);
  });

  it('returns nothing when the dataset has no publisher or the org is unknown', async () => {
    const ex = new BgAdminPublisherExtractor(fakeOrgs({}));
    expect(await ex.extract({ dataset: fakeDataset(null), resources: [] })).toEqual([]);
    expect(await ex.extract({ dataset: fakeDataset('missing'), resources: [] })).toEqual([]);
  });
});
