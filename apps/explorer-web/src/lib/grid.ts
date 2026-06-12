// Pure client-side sort + per-column filter for the resource grid (spreadsheet drilldown). Operates
// over the rows currently loaded into the reader; kept out of the component so it's unit-tested.

import { isNumeric } from './chart.ts';
import { cellText } from './table.ts';

export type SortDir = 'asc' | 'desc';
export interface GridSort {
  col: string;
  dir: SortDir;
}

function cellOf(row: unknown, col: string): unknown {
  return row && typeof row === 'object' ? (row as Record<string, unknown>)[col] : undefined;
}

/** Numeric-aware comparison: numbers sort numerically, blanks sort last, else Bulgarian locale text. */
export function compareCells(a: unknown, b: unknown): number {
  if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b);
  const as = cellText(a);
  const bs = cellText(b);
  if (as === bs) return 0;
  if (as === '') return 1;
  if (bs === '') return -1;
  return as.localeCompare(bs, 'bg');
}

export function sortRows(rows: unknown[], sort: GridSort | null): unknown[] {
  if (!sort) return rows;
  const dir = sort.dir === 'asc' ? 1 : -1;
  // Stable: decorate with the original index and break ties by it.
  return rows
    .map((row, i) => ({ row, i }))
    .sort(
      (x, y) => dir * compareCells(cellOf(x.row, sort.col), cellOf(y.row, sort.col)) || x.i - y.i,
    )
    .map((d) => d.row);
}

/** Keep rows where every active column filter is a (case-insensitive) substring of the cell text. */
export function filterRows(rows: unknown[], filters: Record<string, string>): unknown[] {
  const active = Object.entries(filters).filter(([, v]) => v.trim() !== '');
  if (active.length === 0) return rows;
  return rows.filter((row) =>
    active.every(([col, q]) =>
      cellText(cellOf(row, col)).toLowerCase().includes(q.trim().toLowerCase()),
    ),
  );
}

export function gridRows(
  rows: unknown[],
  sort: GridSort | null,
  filters: Record<string, string>,
): unknown[] {
  return sortRows(filterRows(rows, filters), sort);
}

/** Header-click cycle for a column: unsorted → asc → desc → unsorted. */
export function cycleSort(current: GridSort | null, col: string): GridSort | null {
  if (!current || current.col !== col) return { col, dir: 'asc' };
  if (current.dir === 'asc') return { col, dir: 'desc' };
  return null;
}

/** True when at least one column filter is non-empty. */
export function hasActiveFilters(filters: Record<string, string>): boolean {
  return Object.values(filters).some((v) => v.trim() !== '');
}
