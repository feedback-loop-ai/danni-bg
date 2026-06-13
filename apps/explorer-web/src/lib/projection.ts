// Pure GeoJSON → SVG projection for the choropleth (replaces the WebGL map). d3-geo fits the whole
// country into the viewBox once; each feature becomes an SVG path `d` plus a label anchor (centroid).
// Kept out of the component so it's unit-tested and the map render stays declarative SVG.

import { type GeoPermissibleObjects, geoMercator, geoPath } from 'd3-geo';
import type { BoundaryCollection } from './choropleth.ts';

export interface ProjectedFeature {
  boundaryFeatureId: string;
  /** SVG path data in the given viewBox coordinate space. */
  d: string;
  /** Label anchor (polygon centroid) in the same space. */
  cx: number;
  cy: number;
}

export function projectBoundaries(
  fc: BoundaryCollection,
  width: number,
  height: number,
): ProjectedFeature[] {
  const projection = geoMercator().fitSize([width, height], fc as unknown as GeoPermissibleObjects);
  const path = geoPath(projection);
  return fc.features.map((f) => {
    const obj = f as unknown as GeoPermissibleObjects;
    const [cx, cy] = path.centroid(obj);
    return {
      boundaryFeatureId: f.properties.boundaryFeatureId,
      d: path(obj) ?? '',
      cx: Number.isFinite(cx) ? cx : 0,
      cy: Number.isFinite(cy) ? cy : 0,
    };
  });
}
