import { describe, expect, it } from 'bun:test';
import { Iso8601DatesExtractor } from '../../../../src/enrich/extractors/iso8601-dates.ts';
import type { DatasetRow } from '../../../../src/store/repos/datasets.ts';

function fakeDataset(title: string, description: string | null = null): DatasetRow {
  return {
    id: 'd1',
    slug: 'd1',
    title_bg: title,
    description_bg: description,
    publisher_id: null,
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

describe('enrich.extractors.iso8601-dates', () => {
  it('extracts ISO dates from title and description', async () => {
    const out = await new Iso8601DatesExtractor().extract({
      dataset: fakeDataset('Report 2024-12-01', 'Issued 2025-01-15'),
      resources: [],
    });
    expect(out.map((c) => c.id).sort()).toEqual(['time:2024-12-01', 'time:2025-01-15']);
  });

  it('dedupes repeated dates', async () => {
    const out = await new Iso8601DatesExtractor().extract({
      dataset: fakeDataset('Date 2024-01-01 again 2024-01-01'),
      resources: [],
    });
    expect(out.length).toBe(1);
  });

  it('returns empty when no dates', async () => {
    expect(
      (
        await new Iso8601DatesExtractor().extract({
          dataset: fakeDataset('No dates here'),
          resources: [],
        })
      ).length,
    ).toBe(0);
  });
});
