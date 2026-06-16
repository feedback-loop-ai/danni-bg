import { describe, expect, it } from 'bun:test';
import { Crosswalk } from '../src/crosswalk.ts';
import type { GeoCrosswalk } from '../src/schema.ts';

const sample: GeoCrosswalk = {
  version: '9.9.9',
  entries: [
    {
      entityId: 'geo:bg-oblast-ruse',
      level: 'oblast',
      boundaryFeatureId: 'BG-18',
      ekatte: null,
      lauId: null,
      iso3166_2: 'BG-18',
    },
    {
      entityId: 'geo:bg-municipality-ruse',
      level: 'municipality',
      boundaryFeatureId: 'ekatte-63427',
      ekatte: '63427',
      lauId: null,
      iso3166_2: null,
    },
  ],
  knownGaps: [{ entityId: 'geo:bg-municipality-troyan', reason: 'pending coverage' }],
};

describe('Crosswalk lookups', () => {
  const cw = new Crosswalk(sample);

  it('resolves entity id to entry and boundary feature id', () => {
    expect(cw.entry('geo:bg-oblast-ruse')?.iso3166_2).toBe('BG-18');
    expect(cw.boundaryFeatureId('geo:bg-municipality-ruse')).toBe('ekatte-63427');
  });

  it('returns undefined for unknown entity id', () => {
    expect(cw.entry('geo:bg-oblast-nope')).toBeUndefined();
    expect(cw.boundaryFeatureId('geo:bg-oblast-nope')).toBeUndefined();
  });

  it('resolves boundary feature id back to its entry (both directions)', () => {
    expect(cw.entityForBoundaryFeature('ekatte-63427')?.entityId).toBe('geo:bg-municipality-ruse');
    expect(cw.entityForBoundaryFeature('missing')).toBeUndefined();
  });

  it('reports known gaps', () => {
    expect(cw.isKnownGap('geo:bg-municipality-troyan')).toBe(true);
    expect(cw.isKnownGap('geo:bg-oblast-ruse')).toBe(false);
  });

  it('filters entries by level and exposes version', () => {
    expect(cw.entriesForLevel('oblast').map((e) => e.entityId)).toEqual(['geo:bg-oblast-ruse']);
    expect(cw.entriesForLevel('municipality')).toHaveLength(1);
    expect(cw.version).toBe('9.9.9');
  });
});
