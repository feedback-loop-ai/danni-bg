// Pure choropleth join (T028 logic, kept out of the MapLibre render glue). Joins per-region dataset
// counts onto bundled boundary features by boundaryFeatureId, and exposes the boundary→entity lookup
// the map uses to translate a clicked polygon back into a mirror entity id.

import type { RegionSummary } from '../types.ts';

export interface BoundaryFeature {
  type: 'Feature';
  properties: Record<string, unknown> & { boundaryFeatureId: string };
  geometry: unknown;
}
export interface BoundaryCollection {
  type: 'FeatureCollection';
  features: BoundaryFeature[];
}

/** Map boundaryFeatureId → dataset count for the current (in-scope) regions. */
export function countsByBoundary(regions: RegionSummary[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of regions) m.set(r.boundaryFeatureId, r.datasetCount);
  return m;
}

/** Map boundaryFeatureId → entityId (null for boundaries with no gazetteer link). */
export function boundaryToEntity(regions: RegionSummary[]): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const r of regions) m.set(r.boundaryFeatureId, r.entityId);
  return m;
}

/** Return a new FeatureCollection with `count`/`hasData` merged onto each feature for data-driven paint. */
export function enrichBoundaries(
  fc: BoundaryCollection,
  regions: RegionSummary[],
): BoundaryCollection {
  const counts = countsByBoundary(regions);
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const count = counts.get(f.properties.boundaryFeatureId) ?? 0;
      return { ...f, properties: { ...f.properties, count, hasData: count > 0 } };
    }),
  };
}

/** Largest dataset count across regions (drives the choropleth color ramp upper bound). */
export function maxCount(regions: RegionSummary[]): number {
  return regions.reduce((m, r) => Math.max(m, r.datasetCount), 0);
}
