// MapLibre choropleth render glue (US1). Per the constitution's sanctioned render-glue exception
// (Principle VIII v1.1.0), this module contains no business logic — the join/enrichment lives in
// lib/choropleth.ts (100% unit-tested) — and is validated behaviorally by Playwright E2E, not line
// coverage. It only wires data-driven paint, click selection, and highlight to the GPU canvas.

import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { type BoundaryCollection, boundaryToEntity, enrichBoundaries } from '../lib/choropleth.ts';
import type { RegionSummary } from '../types.ts';

const BLANK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#0b1021' } }],
};

interface MapViewProps {
  boundaries: BoundaryCollection;
  regions: RegionSummary[];
  highlightGeoIds: string[];
  onSelect: (entityId: string | null) => void;
}

export function MapView({ boundaries, regions, highlightGeoIds, onSelect }: MapViewProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);

  // Init once.
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: BLANK_STYLE,
      center: [25.4, 42.7],
      zoom: 5.5,
    });
    mapRef.current = map;
    map.on('load', () => {
      map.addSource('regions', { type: 'geojson', data: enrichBoundaries(boundaries, []) });
      map.addLayer({
        id: 'regions-fill',
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['get', 'count'],
            0,
            '#1f2937',
            1,
            '#0e7490',
            50,
            '#22d3ee',
          ],
          'fill-opacity': 0.8,
        },
      });
      map.addLayer({
        id: 'regions-outline',
        type: 'line',
        source: 'regions',
        paint: { 'line-color': '#e2e8f0', 'line-width': 0.5 },
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

  // Click → translate the clicked boundary back to its mirror entity id.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lookup = boundaryToEntity(regions);
    const handler = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.boundaryFeatureId as string | undefined;
      if (id) onSelect(lookup.get(id) ?? null);
    };
    map.on('click', 'regions-fill', handler);
    return () => {
      map.off('click', 'regions-fill', handler);
    };
  }, [regions, onSelect]);

  // Highlight cited/selected regions.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('regions-highlight')) return;
    const ids = regions
      .filter((r) => r.entityId && highlightGeoIds.includes(r.entityId))
      .map((r) => r.boundaryFeatureId);
    map.setFilter('regions-highlight', ['in', 'boundaryFeatureId', ...ids]);
  }, [highlightGeoIds, regions]);

  return <div ref={container} className="map-canvas" aria-label="Карта на България" />;
}
