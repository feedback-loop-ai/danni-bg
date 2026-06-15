import { describe, expect, it } from 'bun:test';
import type { BoundaryCollection } from './choropleth.ts';
import { fitTransform, projectBoundaries } from './projection.ts';

const square = (id: string, lon: number, lat: number): BoundaryCollection['features'][number] => ({
  type: 'Feature',
  properties: { boundaryFeatureId: id },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + 1, lat],
        [lon + 1, lat + 1],
        [lon, lat + 1],
        [lon, lat],
      ],
    ],
  },
});

const fc: BoundaryCollection = {
  type: 'FeatureCollection',
  features: [square('A', 23, 42), square('B', 26, 43)],
};

describe('projectBoundaries', () => {
  it('returns an SVG path + in-bounds centroid per feature', () => {
    const out = projectBoundaries(fc, 400, 300);
    expect(out).toHaveLength(2);
    expect(out[0]?.boundaryFeatureId).toBe('A');
    for (const f of out) {
      expect(f.d.startsWith('M')).toBe(true);
      expect(f.cx).toBeGreaterThanOrEqual(0);
      expect(f.cx).toBeLessThanOrEqual(400);
      expect(f.cy).toBeGreaterThanOrEqual(0);
      expect(f.cy).toBeLessThanOrEqual(300);
      expect(f.bounds[0][0]).toBeLessThanOrEqual(f.bounds[1][0]);
      expect(f.bounds[0][1]).toBeLessThanOrEqual(f.bounds[1][1]);
    }
  });
});

describe('fitTransform', () => {
  it('centres and scales a bbox into the viewport', () => {
    // A 100×100 bbox at the origin → fit into 400×300 with 0.9 padding → k = min(4,3)*0.9 = 2.7.
    const t = fitTransform(
      [
        [0, 0],
        [100, 100],
      ],
      400,
      300,
    );
    expect(t.k).toBeCloseTo(2.7, 5);
    // The bbox centre (50,50) maps to the viewport centre (200,150).
    expect(50 * t.k + t.x).toBeCloseTo(200, 5);
    expect(50 * t.k + t.y).toBeCloseTo(150, 5);
  });
});
