// Pure RegionSummary aggregation (T022). Buckets in-scope datasets by the administrative unit they
// link to and emits one RegionSummary per crosswalk entry. Counts are de-duplicated across
// multi-region datasets (each dataset contributes at most once per region). An optional `rollup`
// maps a dataset's link to the region ids it should count toward — used to roll municipalities up
// into their parent oblast, so an oblast's count is the de-duplicated union of datasets linked
// directly to it AND datasets linked to any of its municipalities (a dataset linked to both the
// oblast and one of its municipalities is still counted once). Kept DB-free so the aggregation
// rules are unit-tested in isolation; the route layer supplies the inputs.

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
  /**
   * Maps a dataset link's entity id to the region ids (at the requested level) it counts toward.
   * Defaults to identity (flat: each link counts for its own entity). Supply a roll-up mapping —
   * e.g. municipality → parent oblast — to aggregate hierarchically.
   */
  rollup?: (linkEntityId: string) => string[];
  /**
   * Resolves a region entity's parent oblast id for the emitted `oblastEntityId` (drives the map
   * drill-down), backed by the `part_of` knowledge graph. When omitted, `oblastEntityId` is null.
   */
  parentOf?: (entityId: string) => string | undefined;
}

export function aggregateRegions(input: AggregateRegionsInput): RegionSummary[] {
  const rollup = input.rollup ?? ((id) => [id]);
  // Index by target region id once. Per dataset we first collapse its links to the strongest
  // confidence per target, so a dataset that reaches the same region via several links (e.g. the
  // oblast directly AND one of its municipalities) is counted once, at its strongest placement.
  const byRegion = new Map<string, { datasetIds: Set<string>; maxConfidence: number }>();
  for (const ds of input.datasets) {
    const perTarget = new Map<string, number>();
    for (const link of ds.geoLinks) {
      for (const target of rollup(link.entityId)) {
        const prev = perTarget.get(target);
        if (prev === undefined || link.confidence > prev) perTarget.set(target, link.confidence);
      }
    }
    for (const [target, confidence] of perTarget) {
      let bucket = byRegion.get(target);
      if (!bucket) {
        bucket = { datasetIds: new Set(), maxConfidence: 0 };
        byRegion.set(target, bucket);
      }
      bucket.datasetIds.add(ds.datasetId);
      if (confidence > bucket.maxConfidence) bucket.maxConfidence = confidence;
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
      oblastEntityId: input.parentOf?.(entry.entityId) ?? null,
    };
  });
}
