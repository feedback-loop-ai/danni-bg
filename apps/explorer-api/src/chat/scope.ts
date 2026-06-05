// ScopeDescriptor → server-side post-filter (T044). The chat tool wrappers apply this so the model
// can only ever retrieve in-scope datasets (FR-025). NOTE: `scope.query` is SOFT context only (it
// is passed to the model as background, never enforced as a hard filter — see analysis finding A2);
// only tags/publisherIds/geoUnitIds/freshness/includeWithdrawn are enforced here. An empty
// descriptor = full-mirror scope.

import type { CuratedDatasetView } from '../../../../src/read/dataset-view.ts';
import { type ScopeDescriptor, filterStateSchema } from '../schemas.ts';
import { matchesFilters } from '../scope-filter.ts';

/** Build the hard-filter FilterState implied by a ScopeDescriptor (drops the soft `query`). */
export function scopeToFilterState(scope: ScopeDescriptor) {
  return filterStateSchema.parse({
    ...(scope.tags !== undefined ? { tags: scope.tags } : {}),
    ...(scope.publisherIds !== undefined ? { publisherIds: scope.publisherIds } : {}),
    ...(scope.geoUnitIds !== undefined ? { geoUnitIds: scope.geoUnitIds } : {}),
    ...(scope.freshness !== undefined ? { freshness: scope.freshness } : {}),
    ...(scope.includeWithdrawn !== undefined ? { includeWithdrawn: scope.includeWithdrawn } : {}),
  });
}

export function inScope(view: CuratedDatasetView, scope: ScopeDescriptor): boolean {
  return matchesFilters(view, scopeToFilterState(scope));
}
