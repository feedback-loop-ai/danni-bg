import { describe, expect, it } from 'bun:test';
import type { RegionSummary } from '../types.ts';
import {
  type BoundaryCollection,
  boundaryToEntity,
  countsByBoundary,
  enrichBoundaries,
  maxCount,
} from './choropleth.ts';

const regions: RegionSummary[] = [
  {
    entityId: 'geo:bg-oblast-ruse',
    level: 'oblast',
    labelBg: 'Русе',
    labelEn: 'Ruse',
    boundaryFeatureId: 'BG-18',
    datasetCount: 3,
    hasData: true,
    maxConfidence: 0.9,
  },
  {
    entityId: null,
    level: 'oblast',
    labelBg: 'X',
    labelEn: null,
    boundaryFeatureId: 'BG-99',
    datasetCount: 0,
    hasData: false,
    maxConfidence: 0,
  },
];

const fc: BoundaryCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { boundaryFeatureId: 'BG-18' }, geometry: {} },
    { type: 'Feature', properties: { boundaryFeatureId: 'BG-99' }, geometry: {} },
    { type: 'Feature', properties: { boundaryFeatureId: 'BG-77' }, geometry: {} },
  ],
};

describe('choropleth joins', () => {
  it('maps counts and entities by boundary id', () => {
    expect(countsByBoundary(regions).get('BG-18')).toBe(3);
    expect(boundaryToEntity(regions).get('BG-99')).toBeNull();
    expect(boundaryToEntity(regions).get('BG-18')).toBe('geo:bg-oblast-ruse');
  });

  it('enriches features with count/hasData, defaulting unmatched to 0', () => {
    const out = enrichBoundaries(fc, regions);
    expect(out.features[0]?.properties.count).toBe(3);
    expect(out.features[0]?.properties.hasData).toBe(true);
    expect(out.features[2]?.properties.count).toBe(0);
    expect(out.features[2]?.properties.hasData).toBe(false);
  });

  it('computes the max count', () => {
    expect(maxCount(regions)).toBe(3);
    expect(maxCount([])).toBe(0);
  });
});
