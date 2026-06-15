// Pure GeoJSON → SVG projection for the choropleth (replaces the WebGL map). One projection is fitted
// to the country once and SHARED across layers (oblasts + municipalities) so they align exactly; each
// feature becomes an SVG path `d`, a label anchor (centroid), and a bbox (for drill-down zoom). Kept
// out of the component so it's unit-tested and the map render stays declarative SVG.

import { type GeoPermissibleObjects, type GeoProjection, geoMercator, geoPath } from 'd3-geo';
import type { BoundaryCollection } from './choropleth.ts';

export interface ProjectedFeature {
  boundaryFeatureId: string;
  /** SVG path data in the viewBox coordinate space. */
  d: string;
  /** Label anchor (polygon centroid). */
  cx: number;
  cy: number;
  /** Bounding box `[[x0,y0],[x1,y1]]` in viewBox space. */
  bounds: [[number, number], [number, number]];
}

/** A Mercator projection fitted to `fc`'s extent within the box (share it across layers to align). */
export function makeProjection(
  fc: BoundaryCollection,
  width: number,
  height: number,
): GeoProjection {
  return geoMercator().fitSize([width, height], fc as unknown as GeoPermissibleObjects);
}

export function projectWith(projection: GeoProjection, fc: BoundaryCollection): ProjectedFeature[] {
  const path = geoPath(projection);
  return fc.features.map((f) => {
    const obj = f as unknown as GeoPermissibleObjects;
    const [cx, cy] = path.centroid(obj);
    const bounds = path.bounds(obj) as [[number, number], [number, number]];
    return {
      boundaryFeatureId: f.properties.boundaryFeatureId,
      d: path(obj) ?? '',
      cx: Number.isFinite(cx) ? cx : 0,
      cy: Number.isFinite(cy) ? cy : 0,
      bounds,
    };
  });
}

export function projectBoundaries(
  fc: BoundaryCollection,
  width: number,
  height: number,
): ProjectedFeature[] {
  return projectWith(makeProjection(fc, width, height), fc);
}

/** Transform (translate + scale) that fits `bounds` into the box, centred, with a little padding. */
export function fitTransform(
  bounds: [[number, number], [number, number]],
  width: number,
  height: number,
  pad = 0.9,
): { k: number; x: number; y: number } {
  const [[x0, y0], [x1, y1]] = bounds;
  const w = Math.max(1e-6, x1 - x0);
  const h = Math.max(1e-6, y1 - y0);
  const k = Math.min(width / w, height / h) * pad;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { k, x: width / 2 - cx * k, y: height / 2 - cy * k };
}
