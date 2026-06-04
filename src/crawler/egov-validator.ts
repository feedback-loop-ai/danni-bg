import { sha256Hex } from '../lib/hash.ts';
import type { DatasetDetailsResponse } from './egov-bg-schema.ts';

/**
 * Derive a stable dataset-level `source_etag_or_hash` from `getDatasetDetails` (FR-002,
 * research.md R3). The egov datastore has no per-resource HTTP validator (ETag/Last-Modified),
 * so "unchanged" is decided at the dataset level: prefer `updated_at`, folding in `version`
 * when present; when both are null, fall back to a deterministic sha256 of the consumed metadata
 * fields (`name`, `descript`, `org_id`, `tags`, `updated_at`, `version`).
 *
 * Pure function, no I/O. The fallback hashes the JSON encoding of the consumed fields, so the
 * authoritative Cyrillic title/description round-trips byte-exact into the hash input.
 */
export function datasetValidator(details: DatasetDetailsResponse): string {
  const d = details.data;
  if (d.updated_at !== null && d.updated_at !== undefined) {
    // updated_at present: validator is updated_at, with version folded in when present so a
    // republication that keeps the same updated_at still flips the validator.
    return `ts:${d.updated_at}${d.version !== null && d.version !== undefined ? `|v:${d.version}` : ''}`;
  }
  // Fallback: hash the consumed metadata. version is included so a version-only bump is caught.
  const canonical = {
    name: d.name,
    descript: d.descript ?? null,
    org_id: d.org_id ?? null,
    tags: (d.tags ?? []).map((t) => t.name),
    updated_at: d.updated_at ?? null,
    version: d.version ?? null,
  };
  return sha256Hex(JSON.stringify(canonical));
}
