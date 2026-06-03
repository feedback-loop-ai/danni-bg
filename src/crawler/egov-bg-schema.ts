// Response schemas for data.egov.bg's custom POST API (governmentbg/data-gov-bg).
// Shapes verified against the live portal (June 2026). Schemas are lenient
// (.passthrough) — the portal returns many fields; we validate only what the
// sync consumes and tolerate the rest.
import { z } from 'zod';

export const EgovErrorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    errors: z.record(z.unknown()).optional(),
    error: z
      .object({ type: z.string().nullish(), message: z.string().nullish() })
      .passthrough()
      .optional(),
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
    // The datastore returns rows as an array (array-of-arrays with a header row,
    // or array-of-objects for some resources). Kept opaque; the sync handles both.
    data: z.array(z.unknown()),
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
