import { describe, expect, it } from 'bun:test';
import { ColumnNameHeuristicsExtractor } from '../../../../src/enrich/extractors/column-name-heuristics.ts';
import type { DatasetRow } from '../../../../src/store/repos/datasets.ts';

function fakeDataset(title: string): DatasetRow {
  return {
    id: 'd1',
    slug: 'd1',
    title_bg: title,
    description_bg: null,
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

describe('enrich.extractors.column-name-heuristics', () => {
  it('matches subject keywords in BG/EN', async () => {
    const out = await new ColumnNameHeuristicsExtractor().extract({
      dataset: fakeDataset('Образование - бюджет за 2025'),
      resources: [],
    });
    const ids = out.map((c) => c.id);
    expect(ids).toContain('subject:budget');
    expect(ids).toContain('subject:education');
  });

  it('returns empty when no keywords', async () => {
    const out = await new ColumnNameHeuristicsExtractor().extract({
      dataset: fakeDataset('Random title'),
      resources: [],
    });
    expect(out.length).toBe(0);
  });
});
