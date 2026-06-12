// Server-side scope/filter post-filtering over already-fetched dataset views (T036 core logic,
// reused by chat scope in T044). Pure and DB-free: given a set of dataset views and a FilterState,
// return the views that satisfy every active filter (logical AND across types, FR-012). The free-text
// `query` is NOT applied here — ranked text search happens upstream via search(); this enforces the
// structured filters (tags / publisher / geo / freshness / withdrawn).

import type { CuratedDatasetView } from '../../../src/read/dataset-view.ts';
import { geoEntityIdsOf, matchesFreshness } from './read-bridge.ts';
import type { FilterState } from './schemas.ts';

export function matchesFilters(view: CuratedDatasetView, f: FilterState): boolean {
  if (!f.includeWithdrawn && view.lifecycleState === 'withdrawn') return false;
  if (!matchesFreshness(view.freshness.isStale, f.freshness)) return false;
  if (f.tags.length > 0 && !f.tags.some((t) => view.tags.includes(t))) return false;
  if (f.publisherIds.length > 0) {
    if (!view.publisher || !f.publisherIds.includes(view.publisher.id)) return false;
  }
  if (f.geoUnitIds.length > 0) {
    const geo = new Set(geoEntityIdsOf(view));
    if (!f.geoUnitIds.some((g) => geo.has(g))) return false;
  }
  return true;
}

export function filterViews(views: CuratedDatasetView[], f: FilterState): CuratedDatasetView[] {
  return views.filter((v) => matchesFilters(v, f));
}
