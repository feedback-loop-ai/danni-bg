// Typed fetch client over the explorer API (T018). URL building is pure (and unit-tested); the
// thin fetch wrappers reuse it. Large result sets are paginated via limit/offset (FR-030).

import type { DatasetPointer, FilterState, RegionSummary, ResourceContent } from '../types.ts';
import type { GridSort } from './grid.ts';
import { filterStateToParams } from './scope.ts';

export interface GridQuery {
  sort: GridSort | null;
  filters: Record<string, string>;
}

export function buildUrl(path: string, params?: URLSearchParams): string {
  const qs = params?.toString();
  return qs ? `${path}?${qs}` : path;
}

async function getJson<T>(path: string, params?: URLSearchParams): Promise<T> {
  const res = await fetch(buildUrl(path, params));
  if (!res.ok) throw new Error(`request failed: ${res.status} ${path}`);
  return (await res.json()) as T;
}

export interface DatasetsResponse {
  datasets: DatasetPointer[];
  total: number;
  limit: number;
  offset: number;
}

export interface RegionDatasetsResponse {
  region: RegionSummary;
  datasets: DatasetPointer[];
  total: number;
}

export function fetchRegions(
  f: FilterState,
  level: 'oblast' | 'municipality',
): Promise<{ regions: RegionSummary[] }> {
  const params = filterStateToParams(f);
  params.set('level', level);
  return getJson('/api/regions', params);
}

export function fetchDatasets(f: FilterState, limit = 50, offset = 0): Promise<DatasetsResponse> {
  const params = filterStateToParams(f);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return getJson('/api/datasets', params);
}

export function fetchRegion(entityId: string, f: FilterState): Promise<RegionDatasetsResponse> {
  return getJson(`/api/regions/${encodeURIComponent(entityId)}`, filterStateToParams(f));
}

export function fetchFacets(f: FilterState): Promise<unknown> {
  return getJson('/api/facets', filterStateToParams(f));
}

/** Paginated/sampled rows (or document/text) of one resource — the data drilldown (FR-005/030). */
export function fetchResourceRows(
  datasetId: string,
  resourceId: string,
  limit = 50,
  offset = 0,
  grid?: GridQuery,
): Promise<ResourceContent> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (grid?.sort) {
    params.set('sort', grid.sort.col);
    params.set('dir', grid.sort.dir);
  }
  if (grid?.filters) {
    const active = Object.fromEntries(
      Object.entries(grid.filters).filter(([, v]) => v.trim() !== ''),
    );
    if (Object.keys(active).length > 0) params.set('filters', JSON.stringify(active));
  }
  return getJson(
    `/api/datasets/${encodeURIComponent(datasetId)}/resources/${encodeURIComponent(resourceId)}/rows`,
    params,
  );
}

/** Non-georeferenced (national) datasets — those with no geographic entity (FR-006). */
export function fetchNational(f: FilterState, limit = 50, offset = 0): Promise<DatasetsResponse> {
  const params = filterStateToParams(f);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return getJson('/api/national', params);
}
