// SVG choropleth of Bulgaria's oblasts (replaces the WebGL map). All geometry → SVG projection lives
// in lib/projection.ts and the colour scale in lib/map-scale.ts (both pure + unit-tested); this
// component renders declarative SVG and wires hover/click. Being plain DOM, it renders (and is
// screenshot-tested) headlessly — unlike the previous WebGL canvas.

import { useMemo, useRef, useState } from 'react';
import { type BoundaryCollection, boundaryToEntity, maxCount } from '../lib/choropleth.ts';
import { cn } from '../lib/cn.ts';
import { colorForCount, legendStops } from '../lib/map-scale.ts';
import { projectBoundaries } from '../lib/projection.ts';
import type { RegionSummary } from '../types.ts';

const W = 1000;
const H = 560;

interface MapViewProps {
  boundaries: BoundaryCollection;
  regions: RegionSummary[];
  highlightGeoIds: string[];
  selectedGeoId?: string | null;
  onSelect: (entityId: string | null) => void;
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
  highlightGeoIds,
  selectedGeoId = null,
  onSelect,
  isDark = false,
}: MapViewProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const projected = useMemo(() => projectBoundaries(boundaries, W, H), [boundaries]);
  const byBoundary = useMemo(
    () => new Map(regions.map((r) => [r.boundaryFeatureId, r])),
    [regions],
  );
  const entityToBoundary = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of regions) if (r.entityId) m.set(r.entityId, r.boundaryFeatureId);
    return m;
  }, [regions]);
  const max = maxCount(regions);
  const lookup = useMemo(() => boundaryToEntity(regions), [regions]);

  const highlightBoundaries = new Set(
    highlightGeoIds.map((id) => entityToBoundary.get(id)).filter((b): b is string => !!b),
  );
  const selectedBoundary = selectedGeoId ? entityToBoundary.get(selectedGeoId) : undefined;
  const selectedRegion = selectedBoundary ? byBoundary.get(selectedBoundary) : undefined;

  const outline = isDark ? '#1e293b' : '#ffffff';
  const labelFill = isDark ? '#e2e8f0' : '#1f2937';
  const bg = isDark ? '#0b1220' : '#dfe7ef';

  const move = (id: string, e: React.MouseEvent) => {
    const rect = container.current?.getBoundingClientRect();
    setHover({ id, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
  };
  const click = (boundaryId: string) => {
    const entity = lookup.get(boundaryId) ?? null;
    onSelect(entity && entity === selectedGeoId ? null : entity); // click selected again → deselect
  };

  const hoverRegion = hover ? byBoundary.get(hover.id) : undefined;

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
        {/* Base fills */}
        {projected.map((f) => {
          const region = byBoundary.get(f.boundaryFeatureId);
          const count = region?.datasetCount ?? 0;
          return (
            <path
              key={f.boundaryFeatureId}
              d={f.d}
              fill={colorForCount(count, max, isDark)}
              stroke={outline}
              strokeWidth={0.75}
              className="cursor-pointer transition-[fill] duration-150 focus-visible:outline-none"
              role="button"
              tabIndex={0}
              aria-label={region ? `${region.labelBg}: ${region.datasetCount} набора` : undefined}
              onMouseMove={(e) => move(f.boundaryFeatureId, e)}
              onMouseEnter={(e) => move(f.boundaryFeatureId, e)}
              onClick={() => click(f.boundaryFeatureId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  click(f.boundaryFeatureId);
                }
              }}
            />
          );
        })}
        {/* Outline overlays (drawn on top so borders aren't clipped by neighbouring fills). */}
        {projected.map((f) => {
          const isHi = highlightBoundaries.has(f.boundaryFeatureId);
          const isSel = f.boundaryFeatureId === selectedBoundary;
          const isHov = hover?.id === f.boundaryFeatureId;
          if (!isHi && !isSel && !isHov) return null;
          const stroke = isSel
            ? 'var(--primary)'
            : isHi
              ? '#f59e0b'
              : isDark
                ? '#e2e8f0'
                : '#1f2937';
          return (
            <path
              key={`o-${f.boundaryFeatureId}`}
              d={f.d}
              fill="none"
              stroke={stroke}
              strokeWidth={isSel ? 3 : isHi ? 2.5 : 1.5}
              strokeLinejoin="round"
              className="pointer-events-none"
            />
          );
        })}
        {/* Oblast labels */}
        {projected.map((f) => {
          const region = byBoundary.get(f.boundaryFeatureId);
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
                fontSize: 11,
                fill: labelFill,
                stroke: bg,
                strokeWidth: 2.5,
                paintOrder: 'stroke',
              }}
            >
              {region.labelBg}
            </text>
          );
        })}
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

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-card/90 px-2.5 py-2 text-xs shadow-sm backdrop-blur">
        <div className="mb-1 font-medium text-muted-foreground">Набори по област</div>
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

      {/* Selected-region info card */}
      {selectedRegion && (
        <div className="absolute top-3 right-3 max-w-56 rounded-md border bg-card/95 px-3 py-2 shadow-sm backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium leading-tight">{selectedRegion.labelBg}</div>
              <div className="text-xs text-muted-foreground">
                {selectedRegion.datasetCount} набора
              </div>
            </div>
            <button
              type="button"
              aria-label="Изчисти избора"
              onClick={() => onSelect(null)}
              className={cn(
                'shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground',
                'hover:bg-accent hover:text-accent-foreground',
              )}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
