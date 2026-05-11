import { describe, expect, it } from 'bun:test';
import { CkanTagsExtractor } from '../../../../src/enrich/extractors/ckan-tags.ts';
import type { DatasetRow } from '../../../../src/store/repos/datasets.ts';

function fakeDataset(tags: string[]): DatasetRow {
  return {
    id: 'd1',
    slug: 'd1',
    title_bg: 'A',
    description_bg: null,
    publisher_id: null,
    license_id: null,
    tags_json: JSON.stringify(tags),
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

describe('enrich.extractors.ckan-tags', () => {
  it('emits tag candidates with 0.6 confidence', async () => {
    const out = await new CkanTagsExtractor().extract({
      dataset: fakeDataset(['budget', 'municipality']),
      resources: [],
    });
    expect(out.length).toBe(2);
    expect(out[0]?.confidence).toBe(0.6);
    expect(out[0]?.id.startsWith('tag:')).toBe(true);
  });
});
