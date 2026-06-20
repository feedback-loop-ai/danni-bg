import { describe, expect, it } from 'bun:test';
import { expandGeoUnitIds } from './geo-rollup.ts';

const CHILDREN = new Map<string, string[]>([
  ['geo:bg-oblast-stara-zagora', ['geo:bg-municipality-kazanlak', 'geo:bg-municipality-chirpan']],
  ['geo:bg-oblast-varna', ['geo:bg-municipality-varna', 'geo:bg-municipality-aksakovo']],
]);

describe('expandGeoUnitIds', () => {
  it('expands an oblast to itself + its child municipalities', () => {
    expect(expandGeoUnitIds(['geo:bg-oblast-stara-zagora'], CHILDREN)).toEqual([
      'geo:bg-oblast-stara-zagora',
      'geo:bg-municipality-kazanlak',
      'geo:bg-municipality-chirpan',
    ]);
  });

  it('passes municipality (leaf) and unknown ids through unchanged', () => {
    expect(expandGeoUnitIds(['geo:bg-municipality-kazanlak'], CHILDREN)).toEqual([
      'geo:bg-municipality-kazanlak',
    ]);
    expect(expandGeoUnitIds(['geo:other-xyz'], CHILDREN)).toEqual(['geo:other-xyz']);
  });

  it('de-duplicates the union across multiple oblasts and an explicit child', () => {
    const out = expandGeoUnitIds(
      ['geo:bg-oblast-varna', 'geo:bg-municipality-varna', 'geo:bg-oblast-stara-zagora'],
      CHILDREN,
    );
    expect(new Set(out)).toEqual(
      new Set([
        'geo:bg-oblast-varna',
        'geo:bg-municipality-varna',
        'geo:bg-municipality-aksakovo',
        'geo:bg-oblast-stara-zagora',
        'geo:bg-municipality-kazanlak',
        'geo:bg-municipality-chirpan',
      ]),
    );
    expect(out.length).toBe(6); // no duplicate municipality-varna
  });

  it('returns the same empty array (no work) for an empty filter', () => {
    const empty: string[] = [];
    expect(expandGeoUnitIds(empty, CHILDREN)).toBe(empty);
  });
});
