import { describe, expect, it } from 'bun:test';
import { BgAdminGazetteerExtractor } from '../../../../src/enrich/extractors/bg-admin-gazetteer.ts';
import { findGazetteerMatches } from '../../../../src/enrich/gazetteer/bg-admin.ts';
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

describe('enrich.extractors.bg-admin-gazetteer', () => {
  it('finds known oblasts and municipalities via canonical labels', () => {
    const matches = findGazetteerMatches('Бюджет на Столична община и Пловдив за 2025 г.');
    const ids = matches.map((m) => m.id);
    expect(ids).toContain('geo:bg-municipality-sofia');
    expect(ids).toContain('geo:bg-oblast-plovdiv');
  });

  it('returns empty when no match', () => {
    expect(findGazetteerMatches('Just some unrelated text').length).toBe(0);
  });

  it('extracts geographic entities from dataset title', async () => {
    const ex = new BgAdminGazetteerExtractor();
    const out = await ex.extract({
      dataset: fakeDataset('Бюджет на Столична община'),
      resources: [],
    });
    expect(out.some((c) => c.id === 'geo:bg-municipality-sofia')).toBe(true);
    const sofia = out.find((c) => c.id === 'geo:bg-municipality-sofia');
    expect(sofia?.kind).toBe('geographic_unit');
    expect(sofia?.canonicalLabelEn).toBe('Sofia Municipality');
  });

  it('matches via aliases at lower confidence', async () => {
    const out = await new BgAdminGazetteerExtractor().extract({
      dataset: fakeDataset('Регистър за София'),
      resources: [],
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.confidence).toBeLessThanOrEqual(0.95);
  });
});
