// Server-side sort + per-column filter for tabular resource rows. Applied to the whole resource
// (up to a scan cap) before pagination, so the grid sorts/filters the full dataset — not just the
// page the client happens to have loaded. Pure + unit-tested; the reader binds it to disk rows.

export type SortDir = 'asc' | 'desc';
export interface GridSort {
  col: string;
  dir: SortDir;
}
export interface GridQuery {
  sort: GridSort | null;
  filters: Record<string, string>;
}

/** Largest number of rows scanned for a sort/filter; beyond this the grid sees only the prefix. */
export const MAX_GRID_SCAN = 100_000;

function cellOf(row: unknown, col: string): unknown {
  return row && typeof row === 'object' ? (row as Record<string, unknown>)[col] : undefined;
}

/** Mirrors the client's lib/chart.isNumeric so client and server agree on numeric ordering. */
function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    if (value.trim() === '') return false;
    return Number.isFinite(Number(value));
  }
  return false;
}

/** Mirrors the client's lib/table.cellText. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function compareCells(a: unknown, b: unknown): number {
  if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b);
  const as = cellText(a);
  const bs = cellText(b);
  if (as === bs) return 0;
  if (as === '') return 1;
  if (bs === '') return -1;
  return as.localeCompare(bs, 'bg');
}

export function filterRows(rows: unknown[], filters: Record<string, string>): unknown[] {
  const active = Object.entries(filters).filter(([, v]) => v.trim() !== '');
  if (active.length === 0) return rows;
  return rows.filter((row) =>
    active.every(([col, q]) =>
      cellText(cellOf(row, col)).toLowerCase().includes(q.trim().toLowerCase()),
    ),
  );
}

export function sortRows(rows: unknown[], sort: GridSort | null): unknown[] {
  if (!sort) return rows;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort(
      (x, y) => dir * compareCells(cellOf(x.row, sort.col), cellOf(y.row, sort.col)) || x.i - y.i,
    )
    .map((d) => d.row);
}

/** Filter then sort. */
export function applyGrid(rows: unknown[], query: GridQuery): unknown[] {
  return sortRows(filterRows(rows, query.filters), query.sort);
}

/** True when a sort or any non-blank filter is requested (so the cheap page-slice path can be kept). */
export function isGridActive(query: GridQuery): boolean {
  return query.sort !== null || Object.values(query.filters).some((v) => v.trim() !== '');
}
