// MapLibre choropleth render glue (US1). Per the constitution's sanctioned render-glue exception
// (Principle VIII v1.1.0), the join/enrichment logic lives in lib/choropleth.ts (100% unit-tested);
// this module only wires data-driven paint, fit-to-Bulgaria, hover, and click selection to the GPU
// canvas, validated behaviorally by Playwright E2E.

import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { type BoundaryCollection, boundaryToEntity, enrichBoundaries } from '../lib/choropleth.ts';
import type { RegionSummary } from '../types.ts';

const BG_BOUNDS: [[number, number], [number, number]] = [
  [22.3, 41.2],
  [28.7, 44.3],
];
const BLANK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#dfe7ef' } }],
};
interface MapViewProps {
  boundaries: BoundaryCollection;
  regions: RegionSummary[];
  highlightGeoIds: string[];
  onSelect: (entityId: string | null) => void;
}

interface Hover {
  label: string;
  count: number;
  x: number;
  y: number;
}

export function MapView({ boundaries, regions, highlightGeoIds, onSelect }: MapViewProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: el,
        style: BLANK_STYLE,
        bounds: BG_BOUNDS,
        fitBoundsOptions: { padding: 24 },
      });
    } catch {
      el.setAttribute('data-map-unavailable', 'true');
      return;
    }
    mapRef.current = map;
    map.on('load', () => {
      map.addSource('regions', { type: 'geojson', data: enrichBoundaries(boundaries, []) });
      map.addLayer({
        id: 'regions-fill',
        type: 'fill',
        source: 'regions',
        paint: {
          // Counts are small (single digits), so emphasise the low end: any region with data reads
          // clearly blue, deepening with volume.
          'fill-color': [
            'interpolate',
            ['linear'],
            ['get', 'count'],
            0,
            '#edf2f7',
            1,
            '#9ecae1',
            2,
            '#4292c6',
            3,
            '#2171b5',
            6,
            '#08519c',
          ],
          'fill-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'regions-outline',
        type: 'line',
        source: 'regions',
        paint: { 'line-color': '#ffffff', 'line-width': 1 },
      });
      map.addLayer({
        id: 'regions-hover',
        type: 'line',
        source: 'regions',
        paint: { 'line-color': '#1f2937', 'line-width': 1.5 },
        filter: ['in', 'boundaryFeatureId', ''],
      });
      map.addLayer({
        id: 'regions-highlight',
        type: 'line',
        source: 'regions',
        paint: { 'line-color': '#f59e0b', 'line-width': 3 },
        filter: ['in', 'boundaryFeatureId', ''],
      });
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [boundaries]);

  // Update choropleth data when regions change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('regions') as GeoJSONSource | undefined;
      src?.setData(
        enrichBoundaries(boundaries, regions) as unknown as Parameters<GeoJSONSource['setData']>[0],
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [boundaries, regions]);

  // Hover (tooltip + outline + cursor) and click selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const byBoundary = new Map(regions.map((r) => [r.boundaryFeatureId, r]));
    const lookup = boundaryToEntity(regions);

    const onMove = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.boundaryFeatureId as string | undefined;
      map.getCanvas().style.cursor = id ? 'pointer' : '';
      if (map.getLayer('regions-hover'))
        map.setFilter('regions-hover', ['in', 'boundaryFeatureId', id ?? '']);
      const region = id ? byBoundary.get(id) : undefined;
      if (region)
        setHover({ label: region.labelBg, count: region.datasetCount, x: e.point.x, y: e.point.y });
      else setHover(null);
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = '';
      if (map.getLayer('regions-hover'))
        map.setFilter('regions-hover', ['in', 'boundaryFeatureId', '']);
      setHover(null);
    };
    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.boundaryFeatureId as string | undefined;
      if (id) onSelect(lookup.get(id) ?? null);
    };
    map.on('mousemove', 'regions-fill', onMove);
    map.on('mouseleave', 'regions-fill', onLeave);
    map.on('click', 'regions-fill', onClick);
    return () => {
      map.off('mousemove', 'regions-fill', onMove);
      map.off('mouseleave', 'regions-fill', onLeave);
      map.off('click', 'regions-fill', onClick);
    };
  }, [regions, onSelect]);

  // Highlight cited/selected regions.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('regions-highlight')) return;
    const ids = regions
      .filter((r) => r.entityId && highlightGeoIds.includes(r.entityId))
      .map((r) => r.boundaryFeatureId);
    map.setFilter('regions-highlight', [
      'in',
      'boundaryFeatureId',
      ...(ids.length > 0 ? ids : ['']),
    ]);
  }, [highlightGeoIds, regions]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map-canvas" aria-label="Карта на България" />
      {hover && (
        <div className="map-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <strong>{hover.label}</strong>
          <span>{hover.count} набора</span>
        </div>
      )}
    </div>
  );
}
