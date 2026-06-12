// Pure RegionSummary aggregation (T022). Buckets in-scope datasets by the administrative unit they
// link to and emits one RegionSummary per crosswalk entry. Counts are de-duplicated across
// multi-region datasets (each dataset contributes at most once per region). Kept DB-free so the
// aggregation rules are unit-tested in isolation; the route layer supplies the inputs.

import type { GeoCrosswalkEntry } from '../../../packages/geo-boundaries/src/schema.ts';
import type { RegionSummary } from './schemas.ts';

/** One dataset's geo links (entity id + the confidence of that placement). */
export interface DatasetGeoLink {
  datasetId: string;
  geoLinks: { entityId: string; confidence: number }[];
}

export interface RegionLabel {
  labelBg: string;
  labelEn: string | null;
}

export interface AggregateRegionsInput {
  entries: GeoCrosswalkEntry[];
  labelOf: (entityId: string) => RegionLabel | undefined;
  datasets: DatasetGeoLink[];
}

export function aggregateRegions(input: AggregateRegionsInput): RegionSummary[] {
  // Index links by region entity id once: entityId -> array of { datasetId, confidence }.
  const byRegion = new Map<string, { datasetIds: Set<string>; maxConfidence: number }>();
  for (const ds of input.datasets) {
    for (const link of ds.geoLinks) {
      let bucket = byRegion.get(link.entityId);
      if (!bucket) {
        bucket = { datasetIds: new Set(), maxConfidence: 0 };
        byRegion.set(link.entityId, bucket);
      }
      bucket.datasetIds.add(ds.datasetId);
      if (link.confidence > bucket.maxConfidence) bucket.maxConfidence = link.confidence;
    }
  }

  return input.entries.map((entry) => {
    const bucket = byRegion.get(entry.entityId);
    const label = input.labelOf(entry.entityId);
    const datasetCount = bucket ? bucket.datasetIds.size : 0;
    return {
      entityId: entry.entityId,
      level: entry.level,
      labelBg: label?.labelBg ?? entry.entityId,
      labelEn: label?.labelEn ?? null,
      boundaryFeatureId: entry.boundaryFeatureId,
      datasetCount,
      hasData: datasetCount > 0,
      maxConfidence: bucket ? bucket.maxConfidence : 0,
    };
  });
}
