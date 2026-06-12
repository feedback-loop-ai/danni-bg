import { ArrowDown, ArrowUp, Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchResourceRows } from '../lib/api.ts';
import {
  dateColumns,
  numericColumns,
  orderByDate,
  polylinePoints,
  toSeries,
} from '../lib/chart.ts';
import { cn } from '../lib/cn.ts';
import { type GridSort, cycleSort, hasActiveFilters } from '../lib/grid.ts';
import { cellText, tableColumns, toCsv } from '../lib/table.ts';
import type { ResourceContent } from '../types.ts';

const PAGE = 50;

interface ResourcePreviewProps {
  datasetId: string;
  resourceId: string;
  name: string;
  onClose: () => void;
  /** `panel` = compact side-panel card (default); `reader` = fill the centre document reader. */
  variant?: 'panel' | 'reader';
}

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sameFilters(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

export function ResourcePreview({
  datasetId,
  resourceId,
  name,
  onClose,
  variant = 'panel',
}: ResourcePreviewProps) {
  const reader = variant === 'reader';
  // Scrollable data areas: a fixed cap in the side panel, but grow to fill the centre reader.
  const fill = reader ? 'min-h-0 flex-1' : 'max-h-80';
  const [content, setContent] = useState<ResourceContent | null>(null);
  const [rows, setRows] = useState<unknown[]>([]);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState(false);
  const [view, setView] = useState<'table' | 'chart'>('table');
  const [labelCol, setLabelCol] = useState('');
  const [valueCol, setValueCol] = useState('');
  const [chartType, setChartType] = useState<'bar' | 'line' | null>(null);
  const [sort, setSort] = useState<GridSort | null>(null);
  const [colFilters, setColFilters] = useState<Record<string, string>>({}); // instant (input)
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>({}); // debounced (sent)

  // Reset when the selected resource changes.
  useEffect(() => {
    setRows([]);
    setOffset(0);
    setContent(null);
    setError(false);
    setView('table');
    setLabelCol('');
    setValueCol('');
    setChartType(null);
    setSort(null);
    setColFilters({});
    setAppliedFilters({});
  }, [datasetId, resourceId]);

  // Debounce the per-column filter inputs before they hit the server, and restart from page 0.
  useEffect(() => {
    if (sameFilters(colFilters, appliedFilters)) return;
    const id = setTimeout(() => {
      setAppliedFilters(colFilters);
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [colFilters, appliedFilters]);

  // Sort + filter are applied server-side over the whole resource; offset===0 replaces, else appends.
  useEffect(() => {
    let cancelled = false;
    fetchResourceRows(datasetId, resourceId, PAGE, offset, { sort, filters: appliedFilters })
      .then((c) => {
        if (cancelled) return;
        setContent(c);
        setRows((prev) => (offset === 0 ? c.rows : [...prev, ...c.rows]));
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [datasetId, resourceId, offset, sort, appliedFilters]);

  const columns = tableColumns(rows);
  const hasTable = rows.length > 0 && columns.length > 0;
  const filtering = hasActiveFilters(appliedFilters);
  const numeric = numericColumns(rows, columns);
  const dates = dateColumns(rows, columns);
  // Effective axes: value → first numeric; category → a date column if present (time-series), else
  // the first non-numeric column. Chart type defaults to line when the x-axis is a date column.
  const effValue = numeric.includes(valueCol) ? valueCol : (numeric[0] ?? '');
  const effLabel = labelCol || dates[0] || (columns.find((c) => !numeric.includes(c)) ?? '');
  const effType = chartType ?? (dates.includes(effLabel) ? 'line' : 'bar');
  const series = toSeries(rows, effLabel || null, effValue);
  const points =
    effType === 'line' && dates.includes(effLabel) ? orderByDate(series.points) : series.points;

  function onDownload() {
    if (!content) return;
    if (hasTable) download(`${resourceId}.csv`, toCsv(rows, tableColumns(rows, 100)), 'text/csv');
    else if (content.text !== undefined) download(`${resourceId}.txt`, content.text, 'text/plain');
    else
      download(
        `${resourceId}.json`,
        JSON.stringify(content.document ?? rows, null, 2),
        'application/json',
      );
  }

  return (
    <div
      className={cn(
        'rounded-md border bg-card p-3',
        reader ? 'flex h-full flex-col gap-2' : 'space-y-2',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium" title={name}>
          {name}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {content && (
            <button
              type="button"
              aria-label="Изтегли данните"
              onClick={onDownload}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <Download className="size-4" />
            </button>
          )}
          <button
            type="button"
            aria-label="Затвори визуализацията"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">Грешка при зареждане на данните.</p>}
      {!content && !error && <p className="text-sm text-muted-foreground">Зареждане…</p>}

      {content && hasTable && numeric.length > 0 && (
        <div className="flex gap-1">
          {(['table', 'chart'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-md border px-2 py-1 text-xs',
                view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              {v === 'table' ? 'Таблица' : 'Графика'}
            </button>
          ))}
        </div>
      )}

      {content && hasTable && view === 'chart' && (
        <div
          aria-label="Графика"
          className={cn(reader ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-2')}
        >
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <label className="flex items-center gap-1">
              Стойност:
              <select
                className="rounded border border-input bg-background px-1 py-0.5 text-foreground"
                value={effValue}
                onChange={(e) => setValueCol(e.target.value)}
              >
                {numeric.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              Категория:
              <select
                className="rounded border border-input bg-background px-1 py-0.5 text-foreground"
                value={effLabel}
                onChange={(e) => setLabelCol(e.target.value)}
              >
                <option value="">(номер на ред)</option>
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex gap-1">
            {(['bar', 'line'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={effType === t}
                onClick={() => setChartType(t)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs',
                  effType === t ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                )}
              >
                {t === 'bar' ? 'Стълбове' : 'Линия'}
              </button>
            ))}
          </div>
          {effType === 'line' ? (
            <div className={cn('space-y-1', reader && 'flex min-h-0 flex-1 flex-col')}>
              <svg
                viewBox="0 0 300 120"
                role="img"
                aria-label="Линейна графика"
                className={cn(
                  'w-full rounded border bg-muted/20',
                  reader ? 'min-h-0 flex-1' : 'h-40',
                )}
                preserveAspectRatio="none"
              >
                <polyline
                  points={polylinePoints(
                    points.map((p) => p.value),
                    300,
                    120,
                    series.maxValue,
                  )}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="truncate">{points[0]?.label}</span>
                <span>макс: {series.maxValue}</span>
                <span className="truncate">{points[points.length - 1]?.label}</span>
              </div>
            </div>
          ) : (
            <div className={cn('space-y-1 overflow-auto pr-1', fill)}>
              {points.map((pt, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: ordered series (labels may repeat)
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 truncate" title={pt.label}>
                    {pt.label}
                  </span>
                  <div className="h-3 flex-1 rounded bg-muted">
                    <div
                      className="h-3 rounded bg-primary"
                      style={{
                        width: `${series.maxValue ? (Math.abs(pt.value) / series.maxValue) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right tabular-nums">{pt.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {content && hasTable && view === 'table' && (
        <>
          <div className={cn('overflow-auto rounded border', fill)}>
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  {columns.map((c) => {
                    const active = sort?.col === c;
                    return (
                      <th
                        key={c}
                        aria-sort={
                          active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                        className="whitespace-nowrap border-b px-0 py-0 font-medium"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSort((s) => cycleSort(s, c));
                            setOffset(0);
                          }}
                          className="flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-accent/60"
                        >
                          <span className="truncate">{c}</span>
                          {active &&
                            (sort?.dir === 'asc' ? (
                              <ArrowUp className="size-3 shrink-0" aria-hidden />
                            ) : (
                              <ArrowDown className="size-3 shrink-0" aria-hidden />
                            ))}
                        </button>
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  {columns.map((c) => (
                    <td key={c} className="border-b bg-background px-1 py-1">
                      <input
                        aria-label={`Филтрирай ${c}`}
                        value={colFilters[c] ?? ''}
                        onChange={(e) => setColFilters((f) => ({ ...f, [c]: e.target.value }))}
                        placeholder="филтър…"
                        className="h-6 w-full min-w-20 rounded border border-input bg-background px-1.5 text-xs font-normal placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: ordered append-only page (server-sorted)
                  <tr key={i} className="even:bg-muted/40">
                    {columns.map((c) => {
                      const rec = row as Record<string, unknown>;
                      return (
                        <td
                          key={c}
                          className="max-w-[220px] truncate border-b px-2 py-1"
                          title={cellText(rec?.[c])}
                        >
                          {cellText(rec?.[c])}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {rows.length} от {content.total} реда{filtering && ' (филтрирани)'}
              {filtering && (
                <button
                  type="button"
                  onClick={() => setColFilters({})}
                  className="ml-2 underline-offset-2 hover:underline"
                >
                  изчисти филтрите
                </button>
              )}
              {content.gridTruncated && (
                <span
                  className="ml-2 text-warning"
                  title="Сортирано/филтрирано върху първите 100 000 реда"
                >
                  · върху първите 100k
                </span>
              )}
            </span>
            {rows.length < content.total && (
              <button
                type="button"
                onClick={() => setOffset(rows.length)}
                className="shrink-0 rounded-md border px-2 py-1 hover:bg-accent hover:text-accent-foreground"
              >
                Зареди още
              </button>
            )}
          </div>
        </>
      )}

      {content && !hasTable && content.text !== undefined && (
        <pre
          className={cn(
            'overflow-auto rounded border bg-muted/30 p-2 text-xs whitespace-pre-wrap',
            fill,
          )}
        >
          {content.text}
        </pre>
      )}
      {content && !hasTable && content.text === undefined && (
        <pre className={cn('overflow-auto rounded border bg-muted/30 p-2 text-xs', fill)}>
          {JSON.stringify(content.document ?? rows, null, 2)}
        </pre>
      )}
    </div>
  );
}
