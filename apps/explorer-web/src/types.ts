// Client-side view-model types, mirroring the explorer API response shapes the SPA renders.
// Kept independent of the backend package so the web build stays decoupled.

export type Lang = 'bg' | 'en';
export type FreshnessFilter = 'fresh' | 'stale' | 'any';

export interface FreshnessBlock {
  lastSyncedAt: string;
  sourceLastModified: string | null;
  sourceEtagOrHash: string | null;
  isStale: boolean;
  freshnessSloSeconds: number;
}

export interface FilterState {
  tags: string[];
  publisherIds: string[];
  geoUnitIds: string[];
  freshness: FreshnessFilter;
  query: string;
  includeWithdrawn: boolean;
}

export interface ScopeDescriptor {
  tags?: string[];
  publisherIds?: string[];
  geoUnitIds?: string[];
  datasetIds?: string[];
  freshness?: FreshnessFilter;
  includeWithdrawn?: boolean;
  query?: string;
}

export interface DatasetPointer {
  datasetId: string;
  titleBg: string;
  titleEn: string | null;
  translationConfidence: number | null;
  publisher: { id: string; titleBg: string } | null;
  tags: string[];
  freshness: FreshnessBlock;
  geoEntityIds: string[];
  sourceUrl: string;
  score: number | null;
}

export interface RegionSummary {
  entityId: string | null;
  level: 'oblast' | 'municipality';
  labelBg: string;
  labelEn: string | null;
  boundaryFeatureId: string;
  datasetCount: number;
  hasData: boolean;
  maxConfidence: number;
  flagged?: 'unlinked';
}

export interface Citation {
  datasetId: string;
  titleBg: string;
  sourceUrl: string;
  freshness: FreshnessBlock;
}

export interface MapAnchor {
  geoEntityIds: string[];
  datasetIds: string[];
}

export interface ResourceContent {
  datasetId: string;
  resourceId: string;
  kind: string | null;
  rows: unknown[];
  document?: unknown;
  text?: string;
  total: number;
  limit: number;
  offset: number;
  truncated: boolean;
  /** True when a sort/filter saw only the first slice of a very large resource. */
  gridTruncated?: boolean;
}

export interface ProviderConfig {
  kind: 'openai-compatible' | 'anthropic';
  baseUrl: string | null;
  model: string;
  apiKey: string | null;
  useServerDefault: boolean;
}

export const EMPTY_FILTERS: FilterState = {
  tags: [],
  publisherIds: [],
  geoUnitIds: [],
  freshness: 'any',
  query: '',
  includeWithdrawn: false,
};
