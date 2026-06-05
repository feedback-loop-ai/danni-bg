// Bidirectional integrity of the bundled crosswalk against the gazetteer + GeoJSON (T014).
// CI fails if: a crosswalk row points at a non-existent gazetteer unit or a non-existent boundary
// feature, or a gazetteer unit is neither mapped nor listed as a known gap. This is the guard that
// keeps the map join honest as the gazetteer and boundary bundles evolve.

import { describe, expect, it } from 'bun:test';
import { MUNICIPALITIES, OBLASTS } from '../../../src/enrich/gazetteer/bg-admin.ts';
import { loadCrosswalk, loadMunicipalities, loadOblasts } from '../src/load.ts';

describe('bundled crosswalk integrity', () => {
  const crosswalk = loadCrosswalk();
  const oblasts = loadOblasts();
  const municipalities = loadMunicipalities();

  const gazetteerIds = new Set<string>([
    ...OBLASTS.map((o) => o.id),
    ...MUNICIPALITIES.map((m) => m.id),
  ]);
  const boundaryFeatureIds = new Set<string>([
    ...oblasts.features.map((f) => f.properties.boundaryFeatureId),
    ...municipalities.features.map((f) => f.properties.boundaryFeatureId),
  ]);

  it('parses and is non-empty', () => {
    expect(crosswalk.entries.length).toBeGreaterThan(0);
  });

  it('every crosswalk entityId exists in the gazetteer (no orphan rows)', () => {
    const orphans = crosswalk.entries.filter((e) => !gazetteerIds.has(e.entityId));
    expect(orphans).toEqual([]);
  });

  it('every crosswalk boundaryFeatureId exists in a GeoJSON collection', () => {
    const dangling = crosswalk.entries.filter((e) => !boundaryFeatureIds.has(e.boundaryFeatureId));
    expect(dangling).toEqual([]);
  });

  it('oblast entries join by iso3166_2 matching the gazetteer', () => {
    const byId = new Map(OBLASTS.map((o) => [o.id, o]));
    for (const e of crosswalk.entries.filter((x) => x.level === 'oblast')) {
      expect(e.iso3166_2).toBe(byId.get(e.entityId)?.iso3166_2 ?? null);
    }
  });

  it('every gazetteer unit is either mapped or an explicit known gap', () => {
    const mapped = new Set(crosswalk.entries.map((e) => e.entityId));
    const gaps = new Set(crosswalk.knownGaps.map((g) => g.entityId));
    const uncovered = [...gazetteerIds].filter((id) => !mapped.has(id) && !gaps.has(id));
    expect(uncovered).toEqual([]);
  });

  it('all 28 oblasts are mapped', () => {
    const mappedOblasts = crosswalk.entries.filter((e) => e.level === 'oblast');
    expect(mappedOblasts).toHaveLength(28);
  });
});
