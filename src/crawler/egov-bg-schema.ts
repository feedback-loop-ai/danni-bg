// Response schemas for data.egov.bg's custom POST API (governmentbg/data-gov-bg).
// Shapes verified against the live portal (June 2026). Schemas are lenient
// (.passthrough) — the portal returns many fields; we validate only what the
// sync consumes and tolerate the rest.
import { z } from 'zod';

// The ONLY reliable discriminant is `success: false`. The error/errors payload
// shape varies (object, array, or string), so keep them fully opaque — any
// success:false body must be treated as an error regardless of their shape.
export const EgovErrorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    errors: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

export const EgovDatasetSummarySchema = z
  .object({
    id: z.number().optional(),
    uri: z.string(),
    org_id: z.number().nullish(),
    name: z.string(),
    descript: z.union([z.string(), z.number()]).nullish(),
  })
  .passthrough();

export const ListDatasetsResponseSchema = z
  .object({
    success: z.literal(true),
    total_records: z.number().optional(),
    datasets: z.array(EgovDatasetSummarySchema),
  })
  .passthrough();

export const EgovTagSchema = z.object({ name: z.string() }).passthrough();

export const DatasetDetailsResponseSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        id: z.number().optional(),
        uri: z.string(),
        org_id: z.number().nullish(),
        name: z.string(),
        descript: z.union([z.string(), z.number()]).nullish(),
        category_id: z.number().nullish(),
        source: z.string().nullish(),
        version: z.string().nullish(),
        tags: z.array(EgovTagSchema).nullish(),
        organisation: z
          .object({ uri: z.string().nullish(), name: z.string().nullish() })
          .passthrough()
          .nullish(),
        created_at: z.string().nullish(),
        updated_at: z.string().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export const EgovResourceSchema = z
  .object({
    id: z.number().optional(),
    uri: z.string(),
    dataset_uri: z.string().nullish(),
    name: z.string().nullish(),
    description: z.string().nullish(),
    file_format: z.string().nullish(),
    resource_url: z.string().nullish(),
    http_rq_type: z.string().nullish(),
  })
  .passthrough();

export const ListResourcesResponseSchema = z
  .object({
    success: z.literal(true),
    resources: z.array(EgovResourceSchema),
  })
  .passthrough();

export const ResourceDataResponseSchema = z
  .object({
    success: z.literal(true),
    // The datastore returns either tabular rows (array-of-arrays with a header
    // row, or array-of-objects) OR a single structured document (e.g. an OCDS
    // JSON object for contracting datasets). Kept opaque; the sync handles all.
    // An empty resource omits `data` entirely (the live API responds `{"success":true}`),
    // so `data` is optional — the sync normalizes a missing value to an empty datastore.
    data: z.union([z.array(z.unknown()), z.record(z.unknown())]).optional(),
  })
  .passthrough();

export const EgovOrganisationSchema = z
  .object({
    id: z.number().optional(),
    uri: z.string(),
    name: z.string(),
    description: z.string().nullish(),
  })
  .passthrough();

export const ListOrganisationsResponseSchema = z
  .object({
    success: z.literal(true),
    total_records: z.number().optional(),
    organisations: z.array(EgovOrganisationSchema),
  })
  .passthrough();

export type EgovDatasetSummary = z.infer<typeof EgovDatasetSummarySchema>;
export type DatasetDetailsResponse = z.infer<typeof DatasetDetailsResponseSchema>;
export type EgovResource = z.infer<typeof EgovResourceSchema>;
export type ListDatasetsResponse = z.infer<typeof ListDatasetsResponseSchema>;
export type ListResourcesResponse = z.infer<typeof ListResourcesResponseSchema>;
export type ResourceDataResponse = z.infer<typeof ResourceDataResponseSchema>;
export type ListOrganisationsResponse = z.infer<typeof ListOrganisationsResponseSchema>;
export type EgovOrganisation = z.infer<typeof EgovOrganisationSchema>;
