import { extname } from 'node:path';
import type { ArtifactKind } from './curator.ts';

export interface SniffOptions {
  fileName?: string | null;
  declaredFormat?: string | null;
  declaredContentType?: string | null;
  /** First ~2KB of the resource bytes for magic-number checks. */
  head?: Buffer | Uint8Array;
}

export interface SniffResult {
  kind: ArtifactKind;
  reason: 'magic' | 'extension' | 'declared-format' | 'declared-content-type' | 'fallback';
}

const TEXT_FORMATS = new Set(['txt', 'text', 'md']);
const TABULAR_FORMATS = new Set(['csv', 'tsv', 'xlsx', 'xls']);
const JSON_FORMATS = new Set(['json', 'jsonl', 'ndjson']);
const GEOJSON_FORMATS = new Set(['geojson']);
const XML_FORMATS = new Set(['xml']);

function magicSniff(head: Buffer | Uint8Array): ArtifactKind | null {
  if (head.length === 0) return null;
  // PK-zip header → xlsx
  if (head[0] === 0x50 && head[1] === 0x4b) return 'tabular';
  // Strip BOM if present
  let start = 0;
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) start = 3;
  const slice = Buffer.from(head.subarray(start, Math.min(head.length, start + 1024)));
  // Skip leading whitespace
  let i = 0;
  while (
    i < slice.length &&
    (slice[i] === 0x20 || slice[i] === 0x09 || slice[i] === 0x0a || slice[i] === 0x0d)
  )
    i++;
  if (i >= slice.length) return null;
  const ch = slice[i];
  if (ch === 0x3c /* < */) return 'xml';
  if (ch === 0x7b /* { */) {
    const text = slice.toString('utf-8', i);
    if (
      /"type"\s*:\s*"(?:Feature(?:Collection)?|Point|Polygon|LineString|MultiPolygon|MultiLineString|MultiPoint|GeometryCollection)"/.test(
        text,
      )
    ) {
      return 'geojson';
    }
    return 'json';
  }
  if (ch === 0x5b /* [ */) return 'json';
  return null;
}

function fromDeclaredFormat(format: string | null | undefined): ArtifactKind | null {
  if (!format) return null;
  const f = format.toLowerCase();
  if (TABULAR_FORMATS.has(f)) return 'tabular';
  if (GEOJSON_FORMATS.has(f)) return 'geojson';
  if (JSON_FORMATS.has(f)) return 'json';
  if (XML_FORMATS.has(f)) return 'xml';
  if (TEXT_FORMATS.has(f)) return 'text';
  return null;
}

function fromExtension(name: string | null | undefined): ArtifactKind | null {
  if (!name) return null;
  const ext = extname(name).replace(/^\./, '').toLowerCase();
  return fromDeclaredFormat(ext);
}

function fromContentType(ct: string | null | undefined): ArtifactKind | null {
  if (!ct) return null;
  const lower = ct.toLowerCase();
  if (lower.includes('csv') || lower.includes('tab-separated') || lower.includes('spreadsheet'))
    return 'tabular';
  if (lower.includes('geo+json')) return 'geojson';
  if (lower.includes('json')) return 'json';
  if (lower.includes('xml')) return 'xml';
  if (lower.startsWith('text/')) return 'text';
  return null;
}

export function sniff(opts: SniffOptions): SniffResult {
  if (opts.head) {
    const m = magicSniff(opts.head);
    if (m) return { kind: m, reason: 'magic' };
  }
  const ext = fromExtension(opts.fileName ?? null);
  if (ext) return { kind: ext, reason: 'extension' };
  const declared = fromDeclaredFormat(opts.declaredFormat ?? null);
  if (declared) return { kind: declared, reason: 'declared-format' };
  const ct = fromContentType(opts.declaredContentType ?? null);
  if (ct) return { kind: ct, reason: 'declared-content-type' };
  return { kind: 'text', reason: 'fallback' };
}
