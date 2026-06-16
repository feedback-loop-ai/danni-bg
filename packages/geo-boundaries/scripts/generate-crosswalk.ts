// Generator for the bundled boundary GeoJSON + gazetteer crosswalk (tasks T012/T014).
//
// Single source of truth: src/enrich/gazetteer/bg-admin.ts. This script derives, for every
// gazetteer oblast and municipality, (a) a boundary feature in the matching GeoJSON collection and
// (b) a crosswalk entry joining the mirror geo-entity id to that feature by official code
// (ISO-3166-2 for oblasts, EKATTE for municipalities). Run with:
//
//   bun run packages/geo-boundaries/scripts/generate-crosswalk.ts
//
// NOTE ON GEOMETRY: oblast polygons are REAL — Eurostat GISCO NUTS3 (1:20M), filtered to Bulgaria and
// committed under data/source/nuts3-bg.geojson, joined to the gazetteer by Cyrillic oblast name.
// Municipality polygons are still DETERMINISTIC PLACEHOLDER squares (real GISCO LAU geometry + full
// ~265-obshtina coverage is the tracked R5 gap, task T062). The official codes (iso3166_2, ekatte)
// are authoritative and drive the join regardless of geometry source.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MUNICIPALITIES, OBLASTS } from '../../../src/enrich/gazetteer/bg-admin.ts';

const DATA_DIR = join(import.meta.dir, '..', 'data');

// Real oblast geometry: Eurostat GISCO NUTS3 (1:20M, EPSG:4326), filtered to Bulgaria and committed
// under data/source/. Joined to the gazetteer by the authoritative Cyrillic oblast name (NUTS_NAME).
const NUTS_NAME_ALIASES: Record<string, string> = { 'София (столица)': 'София (град)' };

interface NutsFeature {
  properties: { NUTS_NAME: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown[] };
}

function loadOblastGeometry(): Map<string, NutsFeature['geometry']> {
  const src = JSON.parse(readFileSync(join(DATA_DIR, 'source', 'nuts3-bg.geojson'), 'utf-8')) as {
    features: NutsFeature[];
  };
  const byLabelBg = new Map(OBLASTS.map((o) => [o.labelBg, o] as const));
  const out = new Map<string, NutsFeature['geometry']>();
  for (const f of src.features) {
    const name = NUTS_NAME_ALIASES[f.properties.NUTS_NAME] ?? f.properties.NUTS_NAME;
    const oblast = byLabelBg.get(name);
    if (!oblast)
      throw new Error(`NUTS oblast "${f.properties.NUTS_NAME}" not matched to gazetteer`);
    out.set(oblast.id, f.geometry);
  }
  return out;
}

interface Feature {
  type: 'Feature';
  properties: {
    boundaryFeatureId: string;
    level: 'oblast' | 'municipality';
    ekatte?: string;
    lauId?: string;
    iso3166_2?: string;
  };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown[] };
}

// Real municipality geometry: Eurostat GISCO LAU 2021 (filtered to BG, committed under data/source/),
// joined to the gazetteer by the official LAU id (entry.lauId). The gazetteer itself (names + parent
// oblasts) is derived from the same source by generate-municipalities.ts.
const lauGeometry = new Map<string, NutsFeature['geometry']>();
for (const f of (
  JSON.parse(readFileSync(join(DATA_DIR, 'source', 'lau-bg.geojson'), 'utf-8')) as {
    features: { properties: { lau_id: string }; geometry: NutsFeature['geometry'] }[];
  }
).features) {
  lauGeometry.set(f.properties.lau_id, f.geometry);
}

const oblastGeometry = loadOblastGeometry();
const oblastFeatures: Feature[] = OBLASTS.map((o) => {
  const geometry = oblastGeometry.get(o.id);
  if (!geometry) throw new Error(`missing geometry for ${o.id}`);
  return {
    type: 'Feature',
    properties: { boundaryFeatureId: o.iso3166_2, level: 'oblast', iso3166_2: o.iso3166_2 },
    geometry,
  };
});

const withGeometry = MUNICIPALITIES.filter((m) => m.lauId && lauGeometry.has(m.lauId));
const municipalityFeatures: Feature[] = withGeometry.map((m) => {
  const lauId = m.lauId as string;
  return {
    type: 'Feature' as const,
    properties: { boundaryFeatureId: `lau-${lauId}`, level: 'municipality' as const, lauId },
    geometry: lauGeometry.get(lauId) as NutsFeature['geometry'],
  };
});

// The administrative hierarchy (municipality -> oblast) is NOT carried here: it lives in the
// entity_relations knowledge graph (predicate part_of), materialised from the gazetteer during
// curate. The crosswalk only joins each entity to its boundary feature + official codes.
interface CrosswalkEntry {
  entityId: string;
  level: 'oblast' | 'municipality';
  boundaryFeatureId: string;
  ekatte: string | null;
  lauId: string | null;
  iso3166_2: string | null;
}

const entries: CrosswalkEntry[] = [
  ...OBLASTS.map((o) => ({
    entityId: o.id,
    level: 'oblast' as const,
    boundaryFeatureId: o.iso3166_2,
    ekatte: null,
    lauId: null,
    iso3166_2: o.iso3166_2,
  })),
  ...withGeometry.map((m) => ({
    entityId: m.id,
    level: 'municipality' as const,
    boundaryFeatureId: `lau-${m.lauId}`,
    ekatte: null,
    lauId: m.lauId as string,
    iso3166_2: null,
  })),
];

// knownGaps: gazetteer municipalities missing real LAU geometry (none with full GISCO LAU coverage).
const knownGaps = MUNICIPALITIES.filter((m) => !m.lauId || !lauGeometry.has(m.lauId)).map((m) => ({
  entityId: m.id,
  reason: 'municipality has no GISCO LAU geometry',
}));

const crosswalk = { version: '0.1.0', entries, knownGaps };

function writeJson(name: string, value: unknown): void {
  writeFileSync(join(DATA_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

writeJson('oblasts.geojson', { type: 'FeatureCollection', features: oblastFeatures });
writeJson('municipalities.geojson', { type: 'FeatureCollection', features: municipalityFeatures });
writeJson('crosswalk.json', crosswalk);

process.stdout.write(
  `generated ${oblastFeatures.length} oblast + ${municipalityFeatures.length} municipality ` +
    `features, ${entries.length} crosswalk entries, ${knownGaps.length} known gaps\n`,
);
