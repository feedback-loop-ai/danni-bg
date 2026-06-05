// Zod schemas for the bundled boundary data + gazetteer crosswalk (Constitution VII).
// These mirror specs/008-map-data-explorer/contracts/geo-crosswalk.schema.json and validate the
// generated data/*.json at load time so a malformed bundle fails fast (T013).

import { z } from 'zod';

export const ENTITY_ID_RE = /^geo:bg-(oblast|municipality)-[a-z0-9-]+$/;
const EKATTE_RE = /^[0-9]{5}$/;
const ISO_RE = /^BG-[0-9]{2}$/;

export const levelSchema = z.enum(['oblast', 'municipality']);
export type GeoLevel = z.infer<typeof levelSchema>;

export const crosswalkEntrySchema = z
  .object({
    entityId: z.string().regex(ENTITY_ID_RE),
    level: levelSchema,
    boundaryFeatureId: z.string().min(1),
    ekatte: z.string().regex(EKATTE_RE).nullable(),
    iso3166_2: z.string().regex(ISO_RE).nullable(),
    oblastEntityId: z
      .string()
      .regex(/^geo:bg-oblast-[a-z0-9-]+$/)
      .nullable(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.level === 'oblast') {
      if (e.ekatte !== null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'oblast entry must have null ekatte',
        });
      if (e.oblastEntityId !== null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'oblast entry must have null oblastEntityId',
        });
      if (e.iso3166_2 === null)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'oblast entry requires iso3166_2' });
    } else {
      if (e.iso3166_2 !== null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'municipality entry must have null iso3166_2',
        });
      if (e.ekatte === null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'municipality entry requires ekatte',
        });
      if (e.oblastEntityId === null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'municipality entry requires oblastEntityId',
        });
    }
  });
export type GeoCrosswalkEntry = z.infer<typeof crosswalkEntrySchema>;

export const knownGapSchema = z
  .object({ entityId: z.string().regex(ENTITY_ID_RE), reason: z.string().min(1) })
  .strict();
export type GeoKnownGap = z.infer<typeof knownGapSchema>;

export const crosswalkSchema = z
  .object({
    version: z.string().min(1),
    entries: z.array(crosswalkEntrySchema),
    knownGaps: z.array(knownGapSchema),
  })
  .strict();
export type GeoCrosswalk = z.infer<typeof crosswalkSchema>;

export const boundaryFeatureSchema = z.object({
  type: z.literal('Feature'),
  properties: z.object({
    boundaryFeatureId: z.string().min(1),
    level: levelSchema,
    ekatte: z.string().regex(EKATTE_RE).optional(),
    iso3166_2: z.string().regex(ISO_RE).optional(),
  }),
  geometry: z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.array(z.number()))),
  }),
});
export type BoundaryFeature = z.infer<typeof boundaryFeatureSchema>;

export const featureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(boundaryFeatureSchema),
});
export type BoundaryCollection = z.infer<typeof featureCollectionSchema>;
