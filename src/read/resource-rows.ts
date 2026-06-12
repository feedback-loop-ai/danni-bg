import type { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CuratedArtifactsRepo, type CuratedKind } from '../store/repos/curated-artifacts.ts';
import { ResourcesRepo } from '../store/repos/resources.ts';
import { type GridQuery, MAX_GRID_SCAN, applyGrid, isGridActive } from './resource-grid.ts';

export interface ReadResourceOptions {
  limit?: number;
  offset?: number;
  /** Server-side sort + per-column filter applied to the whole resource before pagination. */
  grid?: GridQuery;
}

/**
 * The curated content of a single resource, read straight off disk so a consumer never has to know
 * the on-disk layout. Tabular (NDJSON) and JSON-array artifacts return paginated `rows`; a single
 * JSON/GeoJSON document returns `document`; XML/text returns `text`. An uncurated or absent resource
 * returns empty `rows` with `kind: null`.
 */
export interface ResourceContent {
  datasetId: string;
  resourceId: string;
  kind: CuratedKind | null;
  curatedPath: string | null;
  rows: unknown[];
  document?: unknown;
  text?: string;
  total: number;
  limit: number;
  offset: number;
  truncated: boolean;
  /** True when a sort/filter saw only the first MAX_GRID_SCAN rows of a larger resource. */
  gridTruncated?: boolean;
}

const MAX_LIMIT = 1000;

export function readResourceRows(
  db: Database,
  storeRoot: string,
  datasetId: string,
  resourceId: string,
  opts: ReadResourceOptions = {},
): ResourceContent {
  const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const grid = opts.grid;
  const gridActive = grid !== undefined && isGridActive(grid);

  const resource = new ResourcesRepo(db).get(resourceId);
  if (!resource || resource.dataset_id !== datasetId) {
    throw new Error(`resource ${resourceId} not found in dataset ${datasetId}`);
  }

  const artifact = new CuratedArtifactsRepo(db)
    .byDataset(datasetId)
    .find((a) => a.resource_id === resourceId);
  const base: ResourceContent = {
    datasetId,
    resourceId,
    kind: artifact?.kind ?? null,
    curatedPath: artifact?.path ?? null,
    rows: [],
    total: 0,
    limit,
    offset,
    truncated: false,
  };

  // Uncurated (or curated-but-empty path): no readable rows, only the raw resource exists.
  if (!artifact || !artifact.path) return base;
  const abs = join(storeRoot, 'curated', artifact.path);
  if (!existsSync(abs)) return base;
  const raw = readFileSync(abs, 'utf-8');

  const parseJson = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(
        `failed to parse curated artifact ${artifact.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  if (artifact.kind === 'tabular') {
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    if (gridActive && grid) {
      const all = lines.slice(0, MAX_GRID_SCAN).map((l) => parseJson(l));
      const view = applyGrid(all, grid);
      return {
        ...base,
        rows: view.slice(offset, offset + limit),
        total: view.length,
        truncated: offset + limit < view.length,
        gridTruncated: lines.length > MAX_GRID_SCAN,
      };
    }
    const rows = lines.slice(offset, offset + limit).map((l) => parseJson(l));
    return { ...base, rows, total: lines.length, truncated: offset + limit < lines.length };
  }

  if (artifact.kind === 'json' || artifact.kind === 'geojson') {
    const parsed = parseJson(raw);
    if (Array.isArray(parsed)) {
      if (gridActive && grid) {
        const view = applyGrid(parsed.slice(0, MAX_GRID_SCAN), grid);
        return {
          ...base,
          rows: view.slice(offset, offset + limit),
          total: view.length,
          truncated: offset + limit < view.length,
          gridTruncated: parsed.length > MAX_GRID_SCAN,
        };
      }
      return {
        ...base,
        rows: parsed.slice(offset, offset + limit),
        total: parsed.length,
        truncated: offset + limit < parsed.length,
      };
    }
    return { ...base, document: parsed, total: 1 };
  }

  // xml / text — return the document verbatim.
  return { ...base, text: raw, total: 0 };
}
