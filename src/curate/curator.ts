import { join } from 'node:path';
import { safePathSegment } from '../lib/fs.ts';
import type { ResourceRow } from '../store/repos/resources.ts';

export type ArtifactKind = 'tabular' | 'json' | 'geojson' | 'xml' | 'text' | 'uncurated';

/**
 * Filesystem-safe `<dataset>/<resource>` relative directory for a curated artifact, mirroring the
 * raw store. Some egov ids are over-long human-readable titles that exceed the 255-byte per-component
 * limit (Cyrillic = 2 bytes/char); safePathSegment collapses those to a stable hash so `mkdir` never
 * crashes mid-curate. The stored artifact `path` is derived from this, so reads stay consistent.
 */
export function curatedRelDir(resource: Pick<ResourceRow, 'dataset_id' | 'id'>): string {
  return join(safePathSegment(resource.dataset_id), safePathSegment(resource.id));
}

export interface TransformRule {
  rule: string;
  appliedTo: string | string[];
  params?: Record<string, unknown>;
  ruleVersion?: string | null;
}

export interface ColumnSchema {
  canonicalName: string;
  sourceName: string;
  labelBg?: string | null;
  labelEn?: string | null;
  type:
    | 'string'
    | 'integer'
    | 'decimal'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'time'
    | 'geo_point'
    | 'geo_geometry'
    | 'json'
    | 'binary';
  nullable: boolean;
  format?: string | null;
  unit?: string | null;
  interpretationConfidence?: number;
  alternateInterpretations?: Array<{ type: string; format?: string | null; confidence: number }>;
}

export interface TabularSchema {
  kind: 'tabular';
  encoding: 'utf-8';
  rowFormat: 'ndjson';
  rowCount?: number | null;
  columns: ColumnSchema[];
  primaryKey?: string[] | null;
  transformRules?: TransformRule[];
}

export interface JsonShapeSchema {
  kind: 'json' | 'geojson';
  encoding: 'utf-8';
  rootShape: 'array' | 'object' | 'feature_collection' | 'feature';
  transformRules?: TransformRule[];
}

export interface XmlSchema {
  kind: 'xml';
  encoding: 'utf-8';
  rootElement: string;
  transformRules?: TransformRule[];
}

export interface TextSchema {
  kind: 'text';
  encoding: 'utf-8';
  transformRules?: TransformRule[];
}

export type DeclaredSchema = TabularSchema | JsonShapeSchema | XmlSchema | TextSchema;

export interface CuratedArtifactOutput {
  kind: ArtifactKind;
  path: string;
  schema: DeclaredSchema | { kind: 'uncurated' };
  transformRules: TransformRule[];
  uncuratedReason?: string;
}

export interface CurateContext {
  storeRoot: string;
  resource: ResourceRow;
  rawAbsPath: string;
  curatorVersion: string;
}

export interface Curator {
  readonly kind: ArtifactKind;
  canHandle(ctx: CurateContext): boolean | Promise<boolean>;
  curate(ctx: CurateContext): Promise<CuratedArtifactOutput>;
}
