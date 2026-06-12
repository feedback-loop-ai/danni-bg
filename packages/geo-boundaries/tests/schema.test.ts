import { describe, expect, it } from 'bun:test';
import { crosswalkEntrySchema, featureCollectionSchema } from '../src/schema.ts';

const oblast = {
  entityId: 'geo:bg-oblast-ruse',
  level: 'oblast' as const,
  boundaryFeatureId: 'BG-18',
  ekatte: null,
  iso3166_2: 'BG-18',
  oblastEntityId: null,
};
const municipality = {
  entityId: 'geo:bg-municipality-ruse',
  level: 'municipality' as const,
  boundaryFeatureId: 'ekatte-63427',
  ekatte: '63427',
  iso3166_2: null,
  oblastEntityId: 'geo:bg-oblast-ruse',
};

describe('crosswalkEntrySchema level invariants', () => {
  it('accepts well-formed oblast and municipality entries', () => {
    expect(crosswalkEntrySchema.parse(oblast)).toEqual(oblast);
    expect(crosswalkEntrySchema.parse(municipality)).toEqual(municipality);
  });

  it('rejects an oblast carrying ekatte / oblastEntityId, or missing iso3166_2', () => {
    expect(crosswalkEntrySchema.safeParse({ ...oblast, ekatte: '63427' }).success).toBe(false);
    expect(
      crosswalkEntrySchema.safeParse({ ...oblast, oblastEntityId: 'geo:bg-oblast-x' }).success,
    ).toBe(false);
    expect(crosswalkEntrySchema.safeParse({ ...oblast, iso3166_2: null }).success).toBe(false);
  });

  it('rejects a municipality carrying iso3166_2, or missing ekatte / oblastEntityId', () => {
    expect(crosswalkEntrySchema.safeParse({ ...municipality, iso3166_2: 'BG-18' }).success).toBe(
      false,
    );
    expect(crosswalkEntrySchema.safeParse({ ...municipality, ekatte: null }).success).toBe(false);
    expect(crosswalkEntrySchema.safeParse({ ...municipality, oblastEntityId: null }).success).toBe(
      false,
    );
  });

  it('rejects malformed codes and unknown keys', () => {
    expect(crosswalkEntrySchema.safeParse({ ...oblast, iso3166_2: 'BG-9' }).success).toBe(false);
    expect(crosswalkEntrySchema.safeParse({ ...municipality, ekatte: '123' }).success).toBe(false);
    expect(crosswalkEntrySchema.safeParse({ ...oblast, extra: 1 }).success).toBe(false);
  });
});

describe('featureCollectionSchema', () => {
  it('rejects a non-Polygon geometry', () => {
    const bad = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { boundaryFeatureId: 'BG-18', level: 'oblast', iso3166_2: 'BG-18' },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
      ],
    };
    expect(featureCollectionSchema.safeParse(bad).success).toBe(false);
  });
});
