// Validated loaders for the bundled boundary collections + crosswalk (T013).
// Each loader parses the JSON bundle through its Zod schema so a malformed or hand-edited data file
// fails fast with a precise error instead of silently corrupting the map join.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BoundaryCollection,
  type GeoCrosswalk,
  crosswalkSchema,
  featureCollectionSchema,
} from './schema.ts';

export const DATA_DIR = join(import.meta.dir, '..', 'data');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function loadCrosswalk(dir: string = DATA_DIR): GeoCrosswalk {
  return crosswalkSchema.parse(readJson(join(dir, 'crosswalk.json')));
}

export function loadOblasts(dir: string = DATA_DIR): BoundaryCollection {
  return featureCollectionSchema.parse(readJson(join(dir, 'oblasts.geojson')));
}

export function loadMunicipalities(dir: string = DATA_DIR): BoundaryCollection {
  return featureCollectionSchema.parse(readJson(join(dir, 'municipalities.geojson')));
}
