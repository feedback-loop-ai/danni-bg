import { describe, expect, it } from 'bun:test';
import { BgMonthDatesExtractor } from '../../../../src/enrich/extractors/bg-month-dates.ts';
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

describe('enrich.extractors.bg-month-dates', () => {
  it('extracts dates from BG month names', async () => {
    const out = await new BgMonthDatesExtractor().extract({
      dataset: fakeDataset('Отчет от 5 май 2025 до 15 декември 2025'),
      resources: [],
    });
    expect(out.length).toBe(2);
    expect(out[0]?.confidence).toBe(0.85);
  });

  it('dedupes repeated normalized dates', async () => {
    const out = await new BgMonthDatesExtractor().extract({
      dataset: fakeDataset('5 май 2025 - 5 май 2025'),
      resources: [],
    });
    expect(out.length).toBe(1);
  });

  it('returns empty when no BG dates', async () => {
    expect(
      (
        await new BgMonthDatesExtractor().extract({
          dataset: fakeDataset('No bg date'),
          resources: [],
        })
      ).length,
    ).toBe(0);
  });
});
