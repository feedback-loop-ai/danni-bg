// Generate the FULL Bulgarian municipality dataset from real geometry (T062 — closes the placeholder
// gap). Source: Eurostat GISCO LAU 2021 (1:1M, EPSG:4326), filtered to Bulgaria → data/source/
// lau-bg.geojson (265 obshtini with Cyrillic LAU_NAME + LAU_ID). Parent oblast is derived spatially
// (which real oblast polygon contains the municipality centroid), so no LAU↔NUTS table is needed.
//
// Emits:
//   - src/enrich/gazetteer/municipalities-bg.json   (the 265-entry gazetteer the curate + crosswalk consume)
//   - packages/geo-boundaries/data/municipalities.geojson  (real polygons, keyed `lau-<LAU_ID>`)
//   - merges the 265 municipality entries into packages/geo-boundaries/data/crosswalk.json (oblasts kept)
//
//   bun run packages/geo-boundaries/scripts/generate-municipalities.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { geoCentroid, geoContains, geoDistance } from 'd3-geo';
import { canonicalizeName, transliterateCyrillic } from '../../../src/curate/schema.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');
const DATA = join(import.meta.dir, '..', 'data');

interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}

const lau = JSON.parse(readFileSync(join(DATA, 'source', 'lau-bg.geojson'), 'utf-8')) as {
  features: { properties: { lau_id: string; name: string }; geometry: GeoFeature['geometry'] }[];
};
const oblasts = JSON.parse(readFileSync(join(DATA, 'oblasts.geojson'), 'utf-8')) as {
  features: GeoFeature[];
};
const crosswalk = JSON.parse(readFileSync(join(DATA, 'crosswalk.json'), 'utf-8')) as {
  version: number;
  entries: Record<string, unknown>[];
  knownGaps: unknown[];
};

// boundaryFeatureId (oblast) → oblast entityId, from the existing crosswalk oblast entries.
const oblastEntity = new Map<string, string>();
for (const e of crosswalk.entries) {
  if (e.level === 'oblast') oblastEntity.set(e.boundaryFeatureId as string, e.entityId as string);
}
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// Assign each municipality to the oblast whose real polygon contains its centroid (fallback: nearest).
function parentOblastBoundary(geom: GeoFeature['geometry']): string {
  const c = geoCentroid({ type: 'Feature', properties: {}, geometry: geom } as never);
  for (const o of oblasts.features) {
    if (geoContains(o as never, c)) return o.properties.boundaryFeatureId as string;
  }
  let best = oblasts.features[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const o of oblasts.features) {
    const d = geoDistance(geoCentroid(o as never), c);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best?.properties.boundaryFeatureId as string;
}

const takenSlugs = new Set<string>();
const gazetteer: {
  id: string;
  labelBg: string;
  labelEn: string;
  oblastId: string;
  aliases: string[];
  lauId: string;
}[] = [];
let unmatched = 0;

for (const f of lau.features) {
  const labelBg = f.properties.name;
  const lauId = f.properties.lau_id;
  const slug = canonicalizeName(labelBg, takenSlugs).replace(/_/g, '-');
  const oblastBoundary = parentOblastBoundary(f.geometry);
  const oblastId = oblastEntity.get(oblastBoundary);
  if (!oblastId) unmatched++;

  gazetteer.push({
    id: `geo:bg-municipality-${slug}`,
    labelBg,
    labelEn: titleCase(transliterateCyrillic(labelBg)),
    oblastId: oblastId ?? '',
    // "Доспат" (LAU name) + "Община Доспат" so the curate extractor matches both phrasings.
    aliases: [`Община ${labelBg}`],
    lauId,
  });
}

// Source of truth for the municipality gazetteer; geometry + crosswalk are emitted by
// generate-crosswalk.ts (which joins this to data/source/lau-bg.geojson by lauId).
writeFileSync(
  join(ROOT, 'src', 'enrich', 'gazetteer', 'municipalities-bg.json'),
  `${JSON.stringify(gazetteer, null, 2)}\n`,
);

process.stdout.write(
  `municipalities: ${gazetteer.length} | unmatched-oblast: ${unmatched} | slugs: ${takenSlugs.size}\n`,
);
