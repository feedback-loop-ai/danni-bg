// Pure filter-chip model + mutations for the filter panel (T035/T038). Each active filter becomes a
// removable chip; removing a chip or clearing all returns a new FilterState (immutable updates).

import { EMPTY_FILTERS, type FilterState, type FreshnessFilter } from '../types.ts';

export interface FilterChip {
  kind: 'tag' | 'publisher' | 'geo' | 'freshness' | 'query' | 'withdrawn';
  value: string;
  label: string;
}

export function toChips(f: FilterState): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const t of f.tags) chips.push({ kind: 'tag', value: t, label: `таг: ${t}` });
  for (const p of f.publisherIds)
    chips.push({ kind: 'publisher', value: p, label: `издател: ${p}` });
  for (const g of f.geoUnitIds) chips.push({ kind: 'geo', value: g, label: `регион: ${g}` });
  if (f.freshness !== 'any')
    chips.push({ kind: 'freshness', value: f.freshness, label: `актуалност: ${f.freshness}` });
  if (f.query.trim() !== '')
    chips.push({ kind: 'query', value: f.query.trim(), label: `търсене: ${f.query.trim()}` });
  if (f.includeWithdrawn) chips.push({ kind: 'withdrawn', value: 'true', label: 'вкл. оттеглени' });
  return chips;
}

export function removeChip(f: FilterState, chip: FilterChip): FilterState {
  switch (chip.kind) {
    case 'tag':
      return { ...f, tags: f.tags.filter((t) => t !== chip.value) };
    case 'publisher':
      return { ...f, publisherIds: f.publisherIds.filter((p) => p !== chip.value) };
    case 'geo':
      return { ...f, geoUnitIds: f.geoUnitIds.filter((g) => g !== chip.value) };
    case 'freshness':
      return { ...f, freshness: 'any' };
    case 'query':
      return { ...f, query: '' };
    case 'withdrawn':
      return { ...f, includeWithdrawn: false };
  }
}

/** Toggle a value in one of the multi-select array filters. */
export function toggleValue(
  f: FilterState,
  kind: 'tags' | 'publisherIds' | 'geoUnitIds',
  value: string,
): FilterState {
  const cur = f[kind];
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  return { ...f, [kind]: next };
}

export function setFreshness(f: FilterState, freshness: FreshnessFilter): FilterState {
  return { ...f, freshness };
}

export function clearAll(): FilterState {
  return { ...EMPTY_FILTERS };
}
