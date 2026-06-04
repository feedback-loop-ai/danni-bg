import type { ScopeConfig } from '../config/schema.ts';
import { sha256Hex } from '../lib/hash.ts';

/**
 * Canonical campaign key (FR-003a, research.md R1). The four scope arrays are normalized
 * (lowercase + trim + dedupe + sort ascending) so order/case/duplicate differences map to the
 * SAME campaign. An entirely-empty scope hashes to the fixed `{ all: true }` sentinel so a
 * full-portal campaign has a stable, recognizable key. A scope change yields a different hash →
 * a fresh `crawl_checkpoints` row (the prior one is retained).
 *
 * Normalization operates on ASCII id/slug values only; it never touches authoritative Cyrillic
 * title/description fields (Constitution X). Lowercasing a slug is lossless.
 */

/** The canonical scope object persisted as `crawl_checkpoints.scope_json`. */
export type CanonicalScope =
  | { all: true }
  | { publishers: string[]; categories: string[]; tags: string[]; datasetIds: string[] };

function normalize(values: readonly string[] | undefined): string[] {
  const set = new Set<string>();
  for (const v of values ?? []) {
    const trimmed = v.trim().toLowerCase();
    if (trimmed.length > 0) set.add(trimmed);
  }
  return [...set].sort();
}

export function canonicalScope(scope: ScopeConfig): CanonicalScope {
  const publishers = normalize(scope.publishers);
  const categories = normalize(scope.categories);
  const tags = normalize(scope.tags);
  const datasetIds = normalize(scope.datasetIds);
  if (
    publishers.length === 0 &&
    categories.length === 0 &&
    tags.length === 0 &&
    datasetIds.length === 0
  ) {
    return { all: true };
  }
  return { publishers, categories, tags, datasetIds };
}

export interface ScopeHashResult {
  scopeHash: string;
  canonical: CanonicalScope;
}

export function computeScopeHash(scope: ScopeConfig): ScopeHashResult {
  const canonical = canonicalScope(scope);
  return { scopeHash: sha256Hex(JSON.stringify(canonical)), canonical };
}
