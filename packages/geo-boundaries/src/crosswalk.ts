// Crosswalk lookups: mirror geo-entity id <-> boundary feature id <-> official code (T013).
// All joins go through official codes (ISO-3166-2 / EKATTE), never names, per Constitution X and
// research R5. Construct a Crosswalk once at startup and reuse it for O(1) lookups.

import type { GeoCrosswalk, GeoCrosswalkEntry, GeoLevel } from './schema.ts';

export class Crosswalk {
  private readonly byEntityId = new Map<string, GeoCrosswalkEntry>();
  private readonly byBoundaryFeatureId = new Map<string, GeoCrosswalkEntry>();
  private readonly gapEntityIds: Set<string>;

  constructor(private readonly data: GeoCrosswalk) {
    for (const e of data.entries) {
      this.byEntityId.set(e.entityId, e);
      this.byBoundaryFeatureId.set(e.boundaryFeatureId, e);
    }
    this.gapEntityIds = new Set(data.knownGaps.map((g) => g.entityId));
  }

  entry(entityId: string): GeoCrosswalkEntry | undefined {
    return this.byEntityId.get(entityId);
  }

  boundaryFeatureId(entityId: string): string | undefined {
    return this.byEntityId.get(entityId)?.boundaryFeatureId;
  }

  entityForBoundaryFeature(boundaryFeatureId: string): GeoCrosswalkEntry | undefined {
    return this.byBoundaryFeatureId.get(boundaryFeatureId);
  }

  isKnownGap(entityId: string): boolean {
    return this.gapEntityIds.has(entityId);
  }

  entriesForLevel(level: GeoLevel): GeoCrosswalkEntry[] {
    return this.data.entries.filter((e) => e.level === level);
  }

  get version(): string {
    return this.data.version;
  }
}
