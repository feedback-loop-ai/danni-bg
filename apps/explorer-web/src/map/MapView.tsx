// SVG choropleth of Bulgaria with oblast→municipality drill-down. Geometry projection lives in
// lib/projection.ts and the colour scale in lib/map-scale.ts (both pure + unit-tested); this renders
// declarative SVG and wires hover/click. Click an oblast to zoom into it and reveal its
// municipalities; "← Назад" returns. Plain DOM, so it renders + screenshot-tests headlessly.

import { ArrowLeft } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { type BoundaryCollection, maxCount } from '../lib/choropleth.ts';
import { colorForCount, legendStops } from '../lib/map-scale.ts';
import {
  type ProjectedFeature,
  fitTransform,
  makeProjection,
  projectWith,
} from '../lib/projection.ts';
import type { RegionSummary } from '../types.ts';

const W = 1000;
const H = 560;
const IDENTITY = { k: 1, x: 0, y: 0 };

interface MapViewProps {
  boundaries: BoundaryCollection;
  regions: RegionSummary[];
  municipalities: BoundaryCollection;
  municipalityRegions: RegionSummary[];
  highlightGeoIds: string[];
  selectedGeoIds?: string[];
  /** Replace the selected-region set (the map computes it from clicks + drill context). */
  onSelect: (entityIds: string[]) => void;
  isDark?: boolean;
}

interface Hover {
  id: string;
  x: number;
  y: number;
}

export function MapView({
  boundaries,
  regions,
  municipalities,
  municipalityRegions,
  highlightGeoIds,
  selectedGeoIds = [],
  onSelect,
  isDark = false,
}: MapViewProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [focus, setFocus] = useState<string | null>(null); // focused oblast entityId (drill-down)

  // One projection fitted to the country, shared so oblasts + municipalities align exactly.
  const projection = useMemo(() => makeProjection(boundaries, W, H), [boundaries]);
  const oblastFeatures = useMemo(
    () => projectWith(projection, boundaries),
    [projection, boundaries],
  );
  const muniFeatures = useMemo(
    () => projectWith(projection, municipalities),
    [projection, municipalities],
  );

  const oblastByBoundary = useMemo(
    () => new Map(regions.map((r) => [r.boundaryFeatureId, r])),
    [regions],
  );
  const muniByBoundary = useMemo(
    () => new Map(municipalityRegions.map((r) => [r.boundaryFeatureId, r])),
    [municipalityRegions],
  );
  const oblastEntityToBoundary = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of regions) if (r.entityId) m.set(r.entityId, r.boundaryFeatureId);
    return m;
  }, [regions]);
  const muniEntityToBoundary = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of municipalityRegions) if (r.entityId) m.set(r.entityId, r.boundaryFeatureId);
    return m;
  }, [municipalityRegions]);

  // Municipalities of the focused oblast (their boundary ids), and the projected features to draw.
  const focusedBoundaryIds = useMemo(() => {
    if (!focus) return new Set<string>();
    return new Set(
      municipalityRegions.filter((r) => r.oblastEntityId === focus).map((r) => r.boundaryFeatureId),
    );
  }, [focus, municipalityRegions]);

  const focusedOblastFeature = focus
    ? oblastFeatures.find((f) => f.boundaryFeatureId === oblastEntityToBoundary.get(focus))
    : undefined;

  // Active layer: oblasts (country view) or the focused oblast's municipalities (drill-down).
  const activeFeatures: ProjectedFeature[] = focus
    ? muniFeatures.filter((f) => focusedBoundaryIds.has(f.boundaryFeatureId))
    : oblastFeatures;
  const activeByBoundary = focus ? muniByBoundary : oblastByBoundary;
  const max = focus
    ? municipalityRegions
        .filter((r) => focusedBoundaryIds.has(r.boundaryFeatureId))
        .reduce((m, r) => Math.max(m, r.datasetCount), 0)
    : maxCount(regions);

  const transform = focusedOblastFeature
    ? fitTransform(focusedOblastFeature.bounds, W, H)
    : IDENTITY;

  // Selected regions (multi-select). Resolve each id against the active layer's entity→boundary
  // map; ids from the other layer simply don't render here, which is what we want.
  const activeEntityToBoundary = focus ? muniEntityToBoundary : oblastEntityToBoundary;
  const selectedBoundaries = new Set(
    selectedGeoIds.map((id) => activeEntityToBoundary.get(id)).filter((b): b is string => !!b),
  );
  const highlightBoundaries = new Set(
    highlightGeoIds
      .map((id) => oblastEntityToBoundary.get(id) ?? muniEntityToBoundary.get(id))
      .filter((b): b is string => !!b),
  );

  const outline = isDark ? '#1e293b' : '#ffffff';
  const labelFill = isDark ? '#e2e8f0' : '#1f2937';
  const bg = isDark ? '#0b1220' : '#dfe7ef';

  const move = (id: string, e: React.MouseEvent) => {
    const rect = container.current?.getBoundingClientRect();
    setHover({ id, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
  };
  const toggle = (base: string[], entity: string) =>
    base.includes(entity) ? base.filter((g) => g !== entity) : [...base, entity];

  const activate = (boundaryId: string, additive: boolean) => {
    const region = activeByBoundary.get(boundaryId);
    const entity = region?.entityId ?? null;
    if (!entity) return;
    if (!focus) {
      // Country view. Shift = toggle the oblast into the multi-region union (no drill);
      // plain = drill into the oblast and scope the list to just it.
      if (additive) {
        onSelect(toggle(selectedGeoIds, entity));
      } else {
        setFocus(entity);
        onSelect([entity]);
      }
      return;
    }
    // Drill-down. Selection here is municipality-level, so drop the parent oblast id first
    // (otherwise oblast ⊇ municipality would mask the narrowing). Shift = union; plain =
    // single-select, re-clicking the sole municipality clears it.
    const base = selectedGeoIds.filter((g) => g !== focus);
    if (additive) {
      onSelect(toggle(base, entity));
    } else {
      const isSole = base.length === 1 && base[0] === entity;
      onSelect(isSole ? [] : [entity]);
    }
  };
  const back = () => {
    setFocus(null);
    onSelect([]);
    setHover(null);
  };

  const hoverRegion = hover ? activeByBoundary.get(hover.id) : undefined;
  const selectedRegions = [...selectedBoundaries]
    .map((b) => activeByBoundary.get(b))
    .filter((r): r is RegionSummary => !!r);
  // Labels: every oblast in country view; only the larger municipalities when zoomed (avoid clutter).
  const labelFeatures = focus
    ? activeFeatures.filter((f) => {
        const b = f.bounds;
        return (b[1][0] - b[0][0]) * transform.k > 36;
      })
    : activeFeatures;

  return (
    <div ref={container} className="relative h-full w-full" aria-label="Карта на България">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        style={{ backgroundColor: bg }}
        role="img"
        aria-label="Карта на отворените данни по области"
        onMouseLeave={() => setHover(null)}
      >
        <title>Карта на отворените данни по области</title>
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
          {activeFeatures.map((f) => {
            const region = activeByBoundary.get(f.boundaryFeatureId);
            const count = region?.datasetCount ?? 0;
            return (
              <path
                key={f.boundaryFeatureId}
                d={f.d}
                fill={colorForCount(count, max, isDark)}
                stroke={outline}
                strokeWidth={0.75}
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer transition-[fill] duration-150 focus-visible:outline-none"
                role="button"
                tabIndex={0}
                aria-label={region ? `${region.labelBg}: ${region.datasetCount} набора` : undefined}
                onMouseMove={(e) => move(f.boundaryFeatureId, e)}
                onMouseEnter={(e) => move(f.boundaryFeatureId, e)}
                onClick={(e) => activate(f.boundaryFeatureId, e.shiftKey)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate(f.boundaryFeatureId, e.shiftKey);
                  }
                }}
              />
            );
          })}
          {/* Outline overlays drawn on top (selected / chat-highlight / hover). Selection uses a
              translucent orange fill + bold orange stroke so it stands out against the blue choropleth
              (var(--primary) blended in and was barely visible). */}
          {activeFeatures.map((f) => {
            const isHi = highlightBoundaries.has(f.boundaryFeatureId);
            const isSel = selectedBoundaries.has(f.boundaryFeatureId);
            const isHov = hover?.id === f.boundaryFeatureId;
            if (!isHi && !isSel && !isHov) return null;
            const stroke = isSel
              ? isDark
                ? '#fb923c'
                : '#ea580c'
              : isHi
                ? '#f59e0b'
                : isDark
                  ? '#e2e8f0'
                  : '#1f2937';
            const fill = isSel
              ? isDark
                ? 'rgba(251,146,60,0.28)'
                : 'rgba(234,88,12,0.20)'
              : 'none';
            return (
              <path
                key={`o-${f.boundaryFeatureId}`}
                d={f.d}
                fill={fill}
                stroke={stroke}
                strokeWidth={isSel ? 4 : isHi ? 2.5 : 1.5}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                className="pointer-events-none"
              />
            );
          })}
          {labelFeatures.map((f) => {
            const region = activeByBoundary.get(f.boundaryFeatureId);
            if (!region) return null;
            return (
              <text
                key={`t-${f.boundaryFeatureId}`}
                x={f.cx}
                y={f.cy}
                textAnchor="middle"
                dominantBaseline="middle"
                className="pointer-events-none select-none"
                style={{
                  fontSize: 11 / transform.k,
                  fill: labelFill,
                  stroke: bg,
                  strokeWidth: 2.5 / transform.k,
                  paintOrder: 'stroke',
                }}
              >
                {region.labelBg}
              </text>
            );
          })}
        </g>
      </svg>

      {hover && hoverRegion && (
        <div
          className="pointer-events-none absolute z-10 flex flex-col gap-0.5 rounded-md bg-foreground/90 px-2.5 py-1.5 text-xs text-background shadow-md"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <strong>{hoverRegion.labelBg}</strong>
          <span className="opacity-80">{hoverRegion.datasetCount} набора</span>
        </div>
      )}

      {/* Drill-down breadcrumb / back */}
      {focus && (
        <button
          type="button"
          onClick={back}
          className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-md border bg-card/90 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft className="size-3.5" /> Назад към областите
        </button>
      )}

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-card/90 px-2.5 py-2 text-xs shadow-sm backdrop-blur">
        <div className="mb-1 font-medium text-muted-foreground">
          {focus ? 'Набори по община' : 'Набори по област'}
        </div>
        <div className="flex items-center gap-0.5">
          {legendStops(max, isDark).map((s) => (
            <span
              key={s.color}
              className="h-3 w-5 first:rounded-l last:rounded-r"
              style={{ backgroundColor: s.color }}
              title={`от ${s.from}`}
            />
          ))}
        </div>
        <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
          <span>0</span>
          <span>{max}</span>
        </div>
      </div>

      {/* Selected-region info card (single or multi-select) — orange accent matches the map outline. */}
      {selectedRegions.length > 0 && (
        <div className="absolute top-3 right-3 max-w-56 rounded-md border-2 border-orange-500 bg-card/95 px-3 py-2 shadow-md ring-1 ring-orange-500/30 backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            {selectedRegions.length === 1 && selectedRegions[0] ? (
              <div>
                <div className="font-medium leading-tight">{selectedRegions[0].labelBg}</div>
                <div className="text-xs text-muted-foreground">
                  {selectedRegions[0].datasetCount} набора
                </div>
              </div>
            ) : (
              <div className="min-w-0">
                <div className="font-medium leading-tight">
                  {selectedRegions.length} {focus ? 'общини' : 'области'} избрани
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {selectedRegions.map((r) => r.labelBg).join(', ')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {selectedRegions.reduce((n, r) => n + r.datasetCount, 0)} набора общо
                </div>
              </div>
            )}
            <button
              type="button"
              aria-label="Изчисти избора"
              onClick={() => onSelect([])}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Shift-to-multiselect hint */}
      <div className="pointer-events-none absolute right-3 bottom-3 rounded-md bg-card/80 px-2 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
        Shift+клик за избор на няколко {focus ? 'общини' : 'области'}
      </div>
    </div>
  );
}
