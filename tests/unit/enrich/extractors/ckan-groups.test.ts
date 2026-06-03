import { describe, expect, it } from 'bun:test';
import { CkanGroupsExtractor } from '../../../../src/enrich/extractors/ckan-groups.ts';
import type { DatasetRow } from '../../../../src/store/repos/datasets.ts';

function fakeDataset(groups: string[]): DatasetRow {
  return {
    id: 'd1',
    slug: 'd1',
    title_bg: 'A',
    description_bg: null,
    publisher_id: null,
    license_id: null,
    tags_json: '[]',
    groups_json: JSON.stringify(groups),
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

describe('enrich.extractors.ckan-groups', () => {
  it('emits one candidate per group', async () => {
    const ex = new CkanGroupsExtractor();
    const out = await ex.extract({ dataset: fakeDataset(['finansi', 'budget']), resources: [] });
    expect(out.length).toBe(2);
    expect(out[0]?.id).toBe('group:finansi');
    expect(out[0]?.kind).toBe('group');
  });

  it('emits nothing for empty groups', async () => {
    expect(
      (await new CkanGroupsExtractor().extract({ dataset: fakeDataset([]), resources: [] })).length,
    ).toBe(0);
  });
});
