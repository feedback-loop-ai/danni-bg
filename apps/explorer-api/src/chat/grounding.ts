// Grounding & citation logic (T047). The chat answers strictly from tool results; the backend then
// validates every dataset the model relied on: it MUST exist in the mirror (existence validation,
// SC-005) and MUST be within the request scope (scope validation, SC-008). Surviving datasets become
// Citations; their geo entities become a MapAnchor for the frontend to highlight/focus
// (FR-026/FR-027). All logic here is pure and unit-tested against fixtures.

import type { CuratedDatasetView } from '../../../../src/read/dataset-view.ts';
import { geoEntityIdsOf } from '../read-bridge.ts';
import type { FreshnessBlock } from '../schemas.ts';

export interface Citation {
  datasetId: string;
  titleBg: string;
  sourceUrl: string;
  freshness: FreshnessBlock;
}

export interface MapAnchor {
  geoEntityIds: string[];
  datasetIds: string[];
}

export const SYSTEM_PROMPT = [
  'You are the danni-bg open-data assistant for Bulgaria.',
  'Answer ONLY from the results of the provided tools (mirrorSearch, mirrorEntitySearch, mirrorInfo, readResource).',
  'NEVER invent datasets, values, publishers, or source URLs. If the tools return nothing relevant,',
  'reply exactly that no relevant public data was found.',
  'Cite the specific datasets you used. Surface data freshness, and flag values that are coded or',
  'machine-translated so the user does not over-trust them.',
  'Authoritative Bulgarian fields are shown verbatim; never translate or rewrite them.',
].join(' ');

export const NO_DATA_REPLY = 'No relevant public data was found in the mirror for this question.';

/**
 * Validate the dataset ids the model relied on (from tool results) and build citations:
 * drop ids that do not resolve (hallucinated) or fall outside scope. Deterministic + deduped.
 */
export function buildCitations(
  datasetIds: Iterable<string>,
  resolve: (id: string) => CuratedDatasetView | null,
  inScope: (view: CuratedDatasetView) => boolean,
): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const id of datasetIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const view = resolve(id);
    if (!view || !inScope(view)) continue;
    out.push({
      datasetId: view.datasetId,
      titleBg: view.title.bg,
      sourceUrl: view.sourceUrl,
      freshness: view.freshness,
    });
  }
  return out;
}

/** Aggregate the cited datasets' geo entities + ids into a single map anchor. */
export function buildAnchors(
  citations: Citation[],
  resolve: (id: string) => CuratedDatasetView | null,
): MapAnchor {
  const geo = new Set<string>();
  for (const c of citations) {
    const view = resolve(c.datasetId);
    if (view) for (const g of geoEntityIdsOf(view)) geo.add(g);
  }
  return { geoEntityIds: [...geo], datasetIds: citations.map((c) => c.datasetId) };
}
