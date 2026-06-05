export { Crosswalk } from './crosswalk.ts';
export {
  DATA_DIR,
  loadCrosswalk,
  loadMunicipalities,
  loadOblasts,
} from './load.ts';
export {
  type BoundaryCollection,
  type BoundaryFeature,
  type GeoCrosswalk,
  type GeoCrosswalkEntry,
  type GeoKnownGap,
  type GeoLevel,
  boundaryFeatureSchema,
  crosswalkEntrySchema,
  crosswalkSchema,
  featureCollectionSchema,
} from './schema.ts';
