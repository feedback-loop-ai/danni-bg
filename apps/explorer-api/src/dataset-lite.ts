// Lightweight catalog projection for the list / regions / national / facets endpoints (T-scale).
// Those endpoints need only pointer-level fields + geo links across the WHOLE catalog. Materializing
// a full CuratedDatasetView per dataset (≈7 queries each) does not scale: at ~11k datasets it cost
// tens of GB of RAM and timed out. ReadBridge.listLite() loads the same information in a handful of
// bulk queries; the pure helpers here project/filter that result and are unit-tested without a DB.

import { matchesFreshness } from './read-bridge.ts';
import type { DatasetPointer, FilterState, FreshnessBlock } from './schemas.ts';

export interface DatasetLite {
  datasetId: string;
  titleBg: string;
  titleEn: string | null;
  translationConfidence: number | null;
  publisherId: string | null;
  publisherTitleBg: string | null;
  tags: string[];
  lifecycleState: string;
  sourceUrl: string;
  freshness: FreshnessBlock;
  /** Geo entity links (entity ids namespaced `geo:`), de-duplicated to max confidence per entity. */
  geoLinks: { entityId: string; confidence: number }[];
}

/** Project a lite record into the SPA-facing DatasetPointer (mirrors viewToPointer). */
export function liteToPointer(lite: DatasetLite, score: number | null = null): DatasetPointer {
  return {
    datasetId: lite.datasetId,
    titleBg: lite.titleBg,
    titleEn: lite.titleEn,
    translationConfidence: lite.translationConfidence,
    publisher: lite.publisherId
      ? { id: lite.publisherId, titleBg: lite.publisherTitleBg ?? '' }
      : null,
    tags: lite.tags,
    freshness: lite.freshness,
    geoEntityIds: lite.geoLinks.map((g) => g.entityId),
    sourceUrl: lite.sourceUrl,
    score,
  };
}

/** Structured-filter predicate over a lite record (mirrors matchesFilters; `query` is not applied). */
export function matchesFiltersLite(lite: DatasetLite, f: FilterState): boolean {
  if (!f.includeWithdrawn && lite.lifecycleState === 'withdrawn') return false;
  if (!matchesFreshness(lite.freshness.isStale, f.freshness)) return false;
  if (f.tags.length > 0 && !f.tags.some((t) => lite.tags.includes(t))) return false;
  if (f.publisherIds.length > 0) {
    if (!lite.publisherId || !f.publisherIds.includes(lite.publisherId)) return false;
  }
  if (f.geoUnitIds.length > 0) {
    const geo = new Set(lite.geoLinks.map((g) => g.entityId));
    if (!f.geoUnitIds.some((g) => geo.has(g))) return false;
  }
  return true;
}

/** Highest geo-link confidence for a given region entity (0 when the dataset does not link to it). */
export function liteConfidenceFor(lite: DatasetLite, entityId: string): number {
  let max = 0;
  for (const g of lite.geoLinks)
    if (g.entityId === entityId && g.confidence > max) max = g.confidence;
  return max;
}

/** True when the dataset carries at least one geographic link. */
export function hasGeo(lite: DatasetLite): boolean {
  return lite.geoLinks.length > 0;
}
