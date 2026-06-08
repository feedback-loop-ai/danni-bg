// MapLibre choropleth render glue (US1). Per the constitution's sanctioned render-glue exception
// (Principle VIII v1.1.0), the join/enrichment logic lives in lib/choropleth.ts (100% unit-tested);
// this module only wires data-driven paint, fit-to-Bulgaria, hover, and click selection to the GPU
// canvas, validated behaviorally by Playwright E2E.

import maplibregl, {
  type ExpressionSpecification,
  type GeoJSONSource,
  type Map as MlMap,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { type BoundaryCollection, boundaryToEntity, enrichBoundaries } from '../lib/choropleth.ts';
import type { RegionSummary } from '../types.ts';

const BG_BOUNDS: [[number, number], [number, number]] = [
  [22.3, 41.2],
  [28.7, 44.3],
];
const mapBg = (isDark: boolean) => (isDark ? '#0b1220' : '#dfe7ef');
const outlineColor = (isDark: boolean) => (isDark ? '#0b1220' : '#ffffff');
const hoverColor = (isDark: boolean) => (isDark ? '#e2e8f0' : '#1f2937');

// Base style with a theme-correct background so a dark first load doesn't flash light.
const blankStyle = (isDark: boolean) => ({
  version: 8 as const,
  sources: {},
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': mapBg(isDark) } }],
});
interface MapViewProps {
  boundaries: BoundaryCollection;
  regions: RegionSummary[];
  highlightGeoIds: string[];
  onSelect: (entityId: string | null) => void;
  isDark?: boolean;
}

// Theme-dependent paint. The 0-count colour anchors the choropleth ramp to the map background.
function fillRamp(isDark: boolean) {
  return isDark
    ? [
        'interpolate',
        ['linear'],
        ['get', 'count'],
        0,
        '#0f1c33',
        1,
        '#1d4ed8',
        3,
        '#3b82f6',
        8,
        '#60a5fa',
        20,
        '#93c5fd',
      ]
    : [
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
      ];
}

interface Hover {
  label: string;
  count: number;
  x: number;
  y: number;
}

export function MapView({
  boundaries,
  regions,
  highlightGeoIds,
  onSelect,
  isDark = false,
}: MapViewProps) {
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
        style: blankStyle(isDark),
        bounds: BG_BOUNDS,
        fitBoundsOptions: { padding: 24 },
      });
    } catch {
      el.setAttribute('data-map-unavailable', 'true');
      return;
    }
    mapRef.current = map;
    // The grid/absolute container can resolve its height a tick after init, leaving the GL canvas at a
    // stale size — keep it in sync with the container.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el);
    map.on('load', () => {
      map.resize();
      map.addSource('regions', { type: 'geojson', data: enrichBoundaries(boundaries, []) });
      map.addLayer({
        id: 'regions-fill',
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': fillRamp(isDark) as ExpressionSpecification,
          'fill-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'regions-outline',
        type: 'line',
        source: 'regions',
        paint: { 'line-color': outlineColor(isDark), 'line-width': 1 },
      });
      map.addLayer({
        id: 'regions-hover',
        type: 'line',
        source: 'regions',
        paint: { 'line-color': hoverColor(isDark), 'line-width': 1.5 },
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
      ro.disconnect();
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

  // Re-paint for the active theme (background, choropleth ramp, outlines/hover).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setPaintProperty('bg', 'background-color', mapBg(isDark));
      map.setPaintProperty(
        'regions-fill',
        'fill-color',
        fillRamp(isDark) as ExpressionSpecification,
      );
      map.setPaintProperty('regions-outline', 'line-color', outlineColor(isDark));
      map.setPaintProperty('regions-hover', 'line-color', hoverColor(isDark));
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [isDark]);

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
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" aria-label="Карта на България" />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 flex flex-col gap-0.5 rounded-md bg-foreground/90 px-2.5 py-1.5 text-xs text-background shadow-md"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <strong>{hover.label}</strong>
          <span className="opacity-80">{hover.count} набора</span>
        </div>
      )}
    </div>
  );
}
