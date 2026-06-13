// SVG choropleth of Bulgaria's oblasts (replaces the WebGL map). All geometry → SVG projection lives
// in lib/projection.ts and the colour scale in lib/map-scale.ts (both pure + unit-tested); this
// component renders declarative SVG and wires hover/click. Being plain DOM, it renders (and is
// screenshot-tested) headlessly — unlike the previous WebGL canvas.

import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const dragged = useRef(false);

  const clampK = (k: number) => Math.min(8, Math.max(1, k));
  // Screen → viewBox coords (honours viewBox + preserveAspectRatio letterboxing).
  const toView = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  // Zoom keeping the point `p` (viewBox coords) under the cursor fixed.
  const zoomAt = (p: { x: number; y: number }, factor: number) => {
    setView((v) => {
      const k = clampK(v.k * factor);
      return { k, x: p.x - ((p.x - v.x) / v.k) * k, y: p.y - ((p.y - v.y) / v.k) * k };
    });
  };

  // Wheel zoom as a non-passive listener so we can prevent the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(toView(e.clientX, e.clientY), e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

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
    if (dragged.current) return; // a pan, not a click
    const entity = lookup.get(boundaryId) ?? null;
    onSelect(entity && entity === selectedGeoId ? null : entity); // click selected again → deselect
  };

  const hoverRegion = hover ? byBoundary.get(hover.id) : undefined;

  return (
    <div ref={container} className="relative h-full w-full" aria-label="Карта на България">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full touch-none"
        style={{ backgroundColor: bg, cursor: drag.current ? 'grabbing' : undefined }}
        role="img"
        aria-label="Карта на отворените данни по области"
        onMouseLeave={() => setHover(null)}
        onPointerDown={(e) => {
          dragged.current = false;
          const p = toView(e.clientX, e.clientY);
          drag.current = { sx: p.x, sy: p.y, vx: view.x, vy: view.y };
          // NB: no setPointerCapture — it would retarget the click to the <svg>, breaking
          // region selection. The dragged-flag suppresses click after an actual pan instead.
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const p = toView(e.clientX, e.clientY);
          const dx = p.x - drag.current.sx;
          const dy = p.y - drag.current.sy;
          if (Math.abs(dx) + Math.abs(dy) > 4) dragged.current = true;
          setView((v) => ({
            ...v,
            x: (drag.current as NonNullable<typeof drag.current>).vx + dx,
            y: (drag.current as NonNullable<typeof drag.current>).vy + dy,
          }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
      >
        <title>Карта на отворените данни по области</title>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
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
                vectorEffect="non-scaling-stroke"
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
                vectorEffect="non-scaling-stroke"
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
                  fontSize: 11 / view.k,
                  fill: labelFill,
                  stroke: bg,
                  strokeWidth: 2.5 / view.k,
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

      {/* Zoom controls */}
      <div className="absolute right-3 bottom-3 flex flex-col gap-1">
        <button
          type="button"
          aria-label="Увеличи"
          onClick={() => zoomAt({ x: W / 2, y: H / 2 }, 1.4)}
          className="flex size-7 items-center justify-center rounded-md border bg-card/90 text-muted-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-accent-foreground"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Намали"
          onClick={() => zoomAt({ x: W / 2, y: H / 2 }, 1 / 1.4)}
          className="flex size-7 items-center justify-center rounded-md border bg-card/90 text-muted-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-accent-foreground"
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Нулирай изгледа"
          disabled={view.k === 1 && view.x === 0 && view.y === 0}
          onClick={() => setView({ k: 1, x: 0, y: 0 })}
          className="flex size-7 items-center justify-center rounded-md border bg-card/90 text-muted-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:hover:bg-card/90"
        >
          <RotateCcw className="size-4" />
        </button>
      </div>
    </div>
  );
}
