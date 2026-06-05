// Typed fetch client over the explorer API (T018). URL building is pure (and unit-tested); the
// thin fetch wrappers reuse it. Large result sets are paginated via limit/offset (FR-030).

import type { DatasetPointer, FilterState, RegionSummary } from '../types.ts';
import { filterStateToParams } from './scope.ts';

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

/** Non-georeferenced (national) datasets — those with no geographic entity (FR-006). */
export function fetchNational(f: FilterState, limit = 50, offset = 0): Promise<DatasetsResponse> {
  const params = filterStateToParams(f);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return getJson('/api/national', params);
}
