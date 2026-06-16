import { describe, expect, it } from 'bun:test';
import type { GeoCrosswalkEntry } from '../../../packages/geo-boundaries/src/schema.ts';
import { aggregateRegions } from '../src/regions-aggregate.ts';

const oblast = (slug: string, iso: string): GeoCrosswalkEntry => ({
  entityId: `geo:bg-oblast-${slug}`,
  level: 'oblast',
  boundaryFeatureId: iso,
  ekatte: null,
  lauId: null,
  iso3166_2: iso,
});

const labels: Record<string, { labelBg: string; labelEn: string | null }> = {
  'geo:bg-oblast-sofia-grad': { labelBg: 'София (град)', labelEn: 'Sofia (city)' },
  'geo:bg-oblast-ruse': { labelBg: 'Русе', labelEn: 'Ruse' },
};

describe('aggregateRegions', () => {
  const entries = [oblast('sofia-grad', 'BG-22'), oblast('ruse', 'BG-18')];
  const labelOf = (id: string) => labels[id];

  it('counts datasets per region, deduping multi-region datasets', () => {
    const out = aggregateRegions({
      entries,
      labelOf,
      datasets: [
        {
          datasetId: 'd1',
          geoLinks: [
            { entityId: 'geo:bg-oblast-sofia-grad', confidence: 0.9 },
            { entityId: 'geo:bg-oblast-ruse', confidence: 0.6 },
          ],
        },
        { datasetId: 'd2', geoLinks: [{ entityId: 'geo:bg-oblast-sofia-grad', confidence: 0.5 }] },
        // duplicate link to same region must not double-count
        { datasetId: 'd2', geoLinks: [{ entityId: 'geo:bg-oblast-sofia-grad', confidence: 0.5 }] },
      ],
    });
    const sofia = out.find((r) => r.entityId === 'geo:bg-oblast-sofia-grad');
    const ruse = out.find((r) => r.entityId === 'geo:bg-oblast-ruse');
    expect(sofia?.datasetCount).toBe(2);
    expect(sofia?.maxConfidence).toBe(0.9);
    expect(sofia?.hasData).toBe(true);
    expect(sofia?.labelBg).toBe('София (град)');
    expect(ruse?.datasetCount).toBe(1);
  });

  it('emits empty regions with hasData=false and confidence 0', () => {
    const out = aggregateRegions({ entries, labelOf, datasets: [] });
    expect(out.every((r) => r.datasetCount === 0 && !r.hasData && r.maxConfidence === 0)).toBe(
      true,
    );
  });

  it('rolls municipalities up into their parent oblast, de-duplicated per dataset', () => {
    // The part_of hierarchy (mirrors what the route reads from the knowledge graph): two Sofia-grad
    // municipalities and one Ruse municipality.
    const oblastOf = new Map([
      ['geo:bg-municipality-stolichna', 'geo:bg-oblast-sofia-grad'],
      ['geo:bg-municipality-bozhurishte', 'geo:bg-oblast-sofia-grad'],
      ['geo:bg-municipality-ruse-grad', 'geo:bg-oblast-ruse'],
    ]);
    // Roll-up mirrors the route: oblast links → themselves; municipality links → parent oblast.
    const rollup = (id: string): string[] => {
      if (id.startsWith('geo:bg-oblast-')) return [id];
      const parent = oblastOf.get(id);
      return parent ? [parent] : [];
    };

    const out = aggregateRegions({
      entries,
      labelOf,
      rollup,
      datasets: [
        // Tagged to a municipality only → rolls up to its oblast.
        {
          datasetId: 'd1',
          geoLinks: [{ entityId: 'geo:bg-municipality-bozhurishte', confidence: 0.7 }],
        },
        // Tagged to BOTH the oblast directly AND one of its municipalities → counted once,
        // at the stronger confidence (0.95).
        {
          datasetId: 'd2',
          geoLinks: [
            { entityId: 'geo:bg-oblast-sofia-grad', confidence: 0.95 },
            { entityId: 'geo:bg-municipality-stolichna', confidence: 0.75 },
          ],
        },
        // A different oblast's municipality.
        {
          datasetId: 'd3',
          geoLinks: [{ entityId: 'geo:bg-municipality-ruse-grad', confidence: 0.6 }],
        },
      ],
    });

    const sofia = out.find((r) => r.entityId === 'geo:bg-oblast-sofia-grad');
    const ruse = out.find((r) => r.entityId === 'geo:bg-oblast-ruse');
    // d1 + d2 → 2 distinct datasets under Sofia-grad (d2 not double-counted).
    expect(sofia?.datasetCount).toBe(2);
    expect(sofia?.maxConfidence).toBe(0.95);
    expect(ruse?.datasetCount).toBe(1);
    expect(ruse?.maxConfidence).toBe(0.6);
  });

  it('falls back to the entity id when no label is known', () => {
    const out = aggregateRegions({
      entries: [oblast('x', 'BG-99')],
      labelOf: () => undefined,
      datasets: [],
    });
    expect(out[0]?.labelBg).toBe('geo:bg-oblast-x');
    expect(out[0]?.labelEn).toBeNull();
  });
});
