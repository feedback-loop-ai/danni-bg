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

// Administrative-centre settlement EKATTE codes (numeric, 5-digit) for the sample municipalities.
// Documented stand-in for the LAU municipality code until full GISCO LAU coverage lands (T062).
const MUNICIPALITY_EKATTE: Record<string, string> = {
  'geo:bg-municipality-sofia': '68134',
  'geo:bg-municipality-plovdiv': '56784',
  'geo:bg-municipality-varna': '10135',
  'geo:bg-municipality-burgas': '07079',
  'geo:bg-municipality-ruse': '63427',
  'geo:bg-municipality-stara-zagora': '68850',
};

interface Feature {
  type: 'Feature';
  properties: {
    boundaryFeatureId: string;
    level: 'oblast' | 'municipality';
    ekatte?: string;
    iso3166_2?: string;
  };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown[] };
}

/** A deterministic 0.4°-square placeholder polygon placed on a grid over the BG bounding box. */
function placeholderSquare(index: number): number[][][] {
  const cols = 7;
  const lon0 = 22.5 + (index % cols) * 0.5;
  const lat0 = 41.5 + Math.floor(index / cols) * 0.4;
  const d = 0.4;
  return [
    [
      [lon0, lat0],
      [lon0 + d, lat0],
      [lon0 + d, lat0 + d],
      [lon0, lat0 + d],
      [lon0, lat0],
    ],
  ];
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

const municipalityFeatures: Feature[] = MUNICIPALITIES.map((m, i) => {
  const ekatte = MUNICIPALITY_EKATTE[m.id];
  if (!ekatte) throw new Error(`missing EKATTE for ${m.id}`);
  return {
    type: 'Feature',
    properties: { boundaryFeatureId: `ekatte-${ekatte}`, level: 'municipality', ekatte },
    geometry: { type: 'Polygon', coordinates: placeholderSquare(i + OBLASTS.length) },
  };
});

interface CrosswalkEntry {
  entityId: string;
  level: 'oblast' | 'municipality';
  boundaryFeatureId: string;
  ekatte: string | null;
  iso3166_2: string | null;
  oblastEntityId: string | null;
}

const entries: CrosswalkEntry[] = [
  ...OBLASTS.map((o) => ({
    entityId: o.id,
    level: 'oblast' as const,
    boundaryFeatureId: o.iso3166_2,
    ekatte: null,
    iso3166_2: o.iso3166_2,
    oblastEntityId: null,
  })),
  ...MUNICIPALITIES.map((m) => {
    const ekatte = MUNICIPALITY_EKATTE[m.id];
    if (!ekatte) throw new Error(`missing EKATTE for ${m.id}`);
    return {
      entityId: m.id,
      level: 'municipality' as const,
      boundaryFeatureId: `ekatte-${ekatte}`,
      ekatte,
      iso3166_2: null,
      oblastEntityId: m.oblastId,
    };
  }),
];

// knownGaps: gazetteer municipalities without an EKATTE mapping (none today — the sample is fully
// mapped — but the field is required by the schema and documents the R5 coverage gap going forward).
const knownGaps = MUNICIPALITIES.filter((m) => !MUNICIPALITY_EKATTE[m.id]).map((m) => ({
  entityId: m.id,
  reason: 'municipality boundary/EKATTE mapping pending full GISCO LAU coverage (R5, T062)',
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
