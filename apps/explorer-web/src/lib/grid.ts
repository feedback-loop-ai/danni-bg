// UI helpers for the resource grid's sort/filter controls. The actual sorting/filtering happens
// server-side (see src/read/resource-grid.ts) over the whole resource; these just model the header
// interaction and the filter-active check. Pure + unit-tested.

export type SortDir = 'asc' | 'desc';
export interface GridSort {
  col: string;
  dir: SortDir;
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
