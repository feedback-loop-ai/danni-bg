import { z } from 'zod';

const NullableString = z.string().nullable().optional();

export const CkanErrorSchema = z
  .object({
    __type: z.string(),
    message: z.string().optional(),
  })
  .passthrough();
export type CkanError = z.infer<typeof CkanErrorSchema>;

export const PackageListResponseSchema = z.object({
  help: z.string().optional(),
  success: z.literal(true),
  result: z.array(z.string()),
});
export type PackageListResponse = z.infer<typeof PackageListResponseSchema>;

export const TagSchema = z
  .object({
    name: z.string(),
    display_name: z.string().optional(),
    id: z.string().optional(),
  })
  .passthrough();
export type Tag = z.infer<typeof TagSchema>;

export const GroupRefSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    title: z.string().optional(),
  })
  .passthrough();
export type GroupRef = z.infer<typeof GroupRefSchema>;

export const OrganizationRefSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    title: z.string(),
    description: NullableString,
  })
  .passthrough();
export type OrganizationRef = z.infer<typeof OrganizationRefSchema>;

export const ResourceSchema = z
  .object({
    id: z.string(),
    name: NullableString,
    description: NullableString,
    url: z.string(),
    format: NullableString,
    mimetype: NullableString,
    position: z.number().int().nonnegative().optional().default(0),
    size: z.number().int().nonnegative().nullable().optional(),
    created: NullableString,
    last_modified: NullableString,
  })
  .passthrough();
export type Resource = z.infer<typeof ResourceSchema>;

export const PackageSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    title: z.string(),
    notes: NullableString,
    license_id: NullableString,
    metadata_created: NullableString,
    metadata_modified: NullableString,
    organization: OrganizationRefSchema.nullable().optional(),
    tags: z.array(TagSchema).default([]),
    groups: z.array(GroupRefSchema).default([]),
    resources: z.array(ResourceSchema).default([]),
  })
  .passthrough();
export type Package = z.infer<typeof PackageSchema>;

export const PackageShowResponseSchema = z.object({
  help: z.string().optional(),
  success: z.literal(true),
  result: PackageSchema,
});
export type PackageShowResponse = z.infer<typeof PackageShowResponseSchema>;

export const PackageSearchResponseSchema = z.object({
  help: z.string().optional(),
  success: z.literal(true),
  result: z.object({
    count: z.number().int().nonnegative(),
    results: z.array(PackageSchema),
  }),
});
export type PackageSearchResponse = z.infer<typeof PackageSearchResponseSchema>;

export const OrganizationShowResponseSchema = z.object({
  help: z.string().optional(),
  success: z.literal(true),
  result: OrganizationRefSchema.extend({
    package_count: z.number().int().nonnegative().optional(),
  }),
});
export type OrganizationShowResponse = z.infer<typeof OrganizationShowResponseSchema>;

export const OrganizationListResponseSchema = z.object({
  help: z.string().optional(),
  success: z.literal(true),
  result: z.array(OrganizationRefSchema),
});
export type OrganizationListResponse = z.infer<typeof OrganizationListResponseSchema>;

export const GroupShowResponseSchema = z.object({
  help: z.string().optional(),
  success: z.literal(true),
  result: GroupRefSchema.extend({
    description: NullableString,
    package_count: z.number().int().nonnegative().optional(),
  }),
});
export type GroupShowResponse = z.infer<typeof GroupShowResponseSchema>;

export const GroupListResponseSchema = z.object({
  help: z.string().optional(),
  success: z.literal(true),
  result: z.array(GroupRefSchema),
});
export type GroupListResponse = z.infer<typeof GroupListResponseSchema>;

export const TagListResponseSchema = z.object({
  help: z.string().optional(),
  success: z.literal(true),
  result: z.array(z.union([z.string(), TagSchema])),
});
export type TagListResponse = z.infer<typeof TagListResponseSchema>;

export const CkanErrorEnvelopeSchema = z.object({
  help: z.string().optional(),
  success: z.literal(false),
  error: CkanErrorSchema,
});
export type CkanErrorEnvelope = z.infer<typeof CkanErrorEnvelopeSchema>;
