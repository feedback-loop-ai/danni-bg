// Shared Zod schemas + view-model types for the explorer API (T011, Constitution VII).
// FilterState / ScopeDescriptor are validated at the HTTP and chat boundaries; the view models
// (RegionSummary, DatasetPointer, DatasetDetailView, Facets) are the projection shapes returned to
// the SPA. Every dataset/resource projection carries a FreshnessBlock (Constitution IX).

import { z } from 'zod';

export const freshnessSchema = z.object({
  lastSyncedAt: z.string(),
  sourceLastModified: z.string().nullable(),
  sourceEtagOrHash: z.string().nullable(),
  isStale: z.boolean(),
  freshnessSloSeconds: z.number(),
});
export type FreshnessBlock = z.infer<typeof freshnessSchema>;

export const freshnessFilterSchema = z.enum(['fresh', 'stale', 'any']);
export type FreshnessFilter = z.infer<typeof freshnessFilterSchema>;

/** FilterState — the single shared filter object (data-model.md). All fields optional/defaulted. */
export const filterStateSchema = z
  .object({
    tags: z.array(z.string()).default([]),
    publisherIds: z.array(z.string()).default([]),
    geoUnitIds: z.array(z.string()).default([]),
    freshness: freshnessFilterSchema.default('any'),
    query: z.string().default(''),
    includeWithdrawn: z.boolean().default(false),
  })
  .strict();
export type FilterState = z.infer<typeof filterStateSchema>;

/** ScopeDescriptor — deterministic encoding of FilterState sent with each chat request. */
export const scopeDescriptorSchema = z
  .object({
    tags: z.array(z.string()).optional(),
    publisherIds: z.array(z.string()).optional(),
    geoUnitIds: z.array(z.string()).optional(),
    datasetIds: z.array(z.string()).optional(),
    freshness: freshnessFilterSchema.optional(),
    includeWithdrawn: z.boolean().optional(),
    query: z.string().optional(),
  })
  .strict();
export type ScopeDescriptor = z.infer<typeof scopeDescriptorSchema>;

export const errorCodeSchema = z.enum([
  'bad_request',
  'not_found',
  'provider_error',
  'provider_unconfigured',
  'internal',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export interface ApiError {
  error: { code: ErrorCode; message: string; details?: unknown };
}

// ---- View models (returned to the SPA) ----

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

export interface DatasetResourceView {
  resourceId: string;
  name: string | null;
  kind: string | null;
  schema: unknown;
  freshness: FreshnessBlock;
}
export interface DatasetDetailView {
  datasetId: string;
  titleBg: string;
  titleEn: string | null;
  descriptionBg: string;
  descriptionEn: string | null;
  translationConfidence: number | null;
  publisher: { id: string; titleBg: string } | null;
  tags: string[];
  lifecycleState: string;
  withdrawnReason: string | null;
  freshness: FreshnessBlock;
  geoEntityIds: string[];
  resources: DatasetResourceView[];
  entities: {
    entityId: string;
    kind: string;
    labelBg: string;
    labelEn: string | null;
    confidence: number;
  }[];
  links: { otherDatasetId: string; viaEntityId: string; confidence: number }[];
  sourceUrl: string;
}

export interface FacetItem {
  id: string;
  labelBg: string;
  labelEn?: string | null;
  count: number;
}
export interface Facets {
  tags: FacetItem[];
  publishers: FacetItem[];
  freshnessBuckets: { id: string; count: number }[];
}
