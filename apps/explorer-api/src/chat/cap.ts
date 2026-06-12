// Bound the size of a resource read before it is handed to the chat model. readResourceRows serves
// the SPA drilldown/download with FULL content (a single JSON/GeoJSON `document` or an XML/text blob
// is returned verbatim, and tabular `rows` up to 1000 wide rows) — entirely correct for the UI, but
// a large artifact fed back as a tool result can blow past the model's context window (a real
// 262k-token overflow against the spark Gemma deployment). This caps each heavy field to a character
// budget at the chat boundary only, flagging `truncated` so the model knows the sample is partial.

import type { ResourceContent } from '../../../../src/read/resource-rows.ts';
import type { DatasetDetailView } from '../schemas.ts';

/** ~12k tokens of mixed Cyrillic/JSON; small enough to leave room for several tool calls + output. */
export const MAX_FIELD_CHARS = 40_000;

// A single dataset can carry thousands of related-dataset links (the link heuristic forms large
// cliques around popular shared entities — some datasets exceed 14k links). Serialized whole, that
// alone overflows the model's context. The model only needs the strongest few relations, so cap the
// detail record's links/entities to the highest-confidence head before handing it to the model.
export const MAX_DETAIL_LINKS = 25;
export const MAX_DETAIL_ENTITIES = 40;

export function capDatasetDetail(detail: DatasetDetailView): DatasetDetailView {
  const links =
    detail.links.length > MAX_DETAIL_LINKS
      ? [...detail.links].sort((a, b) => b.confidence - a.confidence).slice(0, MAX_DETAIL_LINKS)
      : detail.links;
  const entities =
    detail.entities.length > MAX_DETAIL_ENTITIES
      ? [...detail.entities]
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, MAX_DETAIL_ENTITIES)
      : detail.entities;
  return { ...detail, links, entities };
}

export function capResourceContent(
  content: ResourceContent,
  maxChars: number = MAX_FIELD_CHARS,
): ResourceContent {
  let out = content;

  if (content.text !== undefined && content.text.length > maxChars) {
    out = { ...out, text: content.text.slice(0, maxChars), truncated: true };
  }

  if (content.document !== undefined) {
    const serialized = JSON.stringify(content.document);
    if (serialized.length > maxChars) {
      out = {
        ...out,
        document: { truncated: true, preview: serialized.slice(0, maxChars) },
        truncated: true,
      };
    }
  }

  if (content.rows.length > 0) {
    const capped: unknown[] = [];
    let used = 0;
    for (const row of content.rows) {
      const size = JSON.stringify(row).length + 1;
      if (capped.length > 0 && used + size > maxChars) break;
      capped.push(row);
      used += size;
    }
    if (capped.length < content.rows.length) {
      out = { ...out, rows: capped, truncated: true };
    }
  }

  return out;
}
