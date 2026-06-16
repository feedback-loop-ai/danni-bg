// The four grounding tools given to the model (T045). Each is a 1:1 server-side wrapper over the
// in-process read API (per contracts/chat-tools.md), and each applies the request scope so the model
// can only retrieve in-scope datasets (FR-025). Every dataset id a tool returns is recorded in
// `citedDatasetIds` so grounding can validate citations afterwards.

import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import type { CuratedDatasetView } from '../../../../src/read/dataset-view.ts';
import type { ReadBridge } from '../read-bridge.ts';
import { viewToDetail } from '../read-bridge.ts';
import type { ScopeDescriptor } from '../schemas.ts';
import { capDatasetDetail, capResourceContent } from './cap.ts';
import { inScope } from './scope.ts';

export interface BuildToolsResult {
  tools: ToolSet;
  citedDatasetIds: Set<string>;
}

function pointer(view: CuratedDatasetView, score: number | null) {
  return {
    datasetId: view.datasetId,
    titleBg: view.title.bg,
    titleEn: view.title.en,
    publisher: view.publisher ? { id: view.publisher.id, titleBg: view.publisher.title.bg } : null,
    sourceUrl: view.sourceUrl,
    freshness: view.freshness,
    score,
  };
}

export function buildTools(bridge: ReadBridge, scope: ScopeDescriptor): BuildToolsResult {
  const citedDatasetIds = new Set<string>();
  const within = (v: CuratedDatasetView) => inScope(v, scope);

  const resolveScoped = (id: string): CuratedDatasetView | null => {
    let view: CuratedDatasetView;
    try {
      view = bridge.view(id);
    } catch {
      return null;
    }
    return within(view) ? view : null;
  };

  const tools: ToolSet = {
    mirrorSearch: tool({
      description:
        'Hybrid keyword + semantic search over the curated mirror. Returns in-scope datasets.',
      inputSchema: z.object({
        query: z.string().min(1),
        lang: z.enum(['bg', 'en', 'auto']).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ query, lang, limit }) => {
        const hits = await bridge.search(query, lang, limit ?? 10);
        const results = [];
        for (const hit of hits) {
          const view = resolveScoped(hit.datasetId);
          if (!view) continue;
          citedDatasetIds.add(view.datasetId);
          results.push(pointer(view, hit.score));
        }
        return { results };
      },
    }),

    mirrorEntitySearch: tool({
      description: 'Find in-scope datasets linked to an entity id (geo/org/tag/time).',
      inputSchema: z.object({
        entityId: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ entityId, limit }) => {
        const hits = await bridge.entityDatasets(entityId, limit ?? 50);
        const results = [];
        for (const hit of hits) {
          const view = resolveScoped(hit.datasetId);
          if (!view) continue;
          citedDatasetIds.add(view.datasetId);
          results.push(pointer(view, hit.score));
        }
        return { entityId, results };
      },
    }),

    mirrorInfo: tool({
      description:
        'The full curated record for one datasetId (returns outOfScope when not in scope).',
      inputSchema: z.object({ datasetId: z.string().min(1) }),
      execute: async ({ datasetId }) => {
        const view = resolveScoped(datasetId);
        if (!view) return { outOfScope: true, datasetId };
        citedDatasetIds.add(view.datasetId);
        // Cap related-dataset links/entities so a high-degree dataset can't overflow the context.
        return capDatasetDetail(viewToDetail(view));
      },
    }),

    readResource: tool({
      description:
        'Read rows (or a document) of a resource within an in-scope dataset. To answer a question ' +
        'about specific values (e.g. "kindergartens in район Панчарево"), pass `filters` — a map of ' +
        'EXACT column name → case-insensitive substring, e.g. {"rayon":"Панчарево"}. Filtering scans ' +
        'the whole resource (up to a cap) and returns ONLY matching rows, so prefer it over paging. ' +
        'Column names are listed in the dataset context block and in mirrorInfo.',
      inputSchema: z.object({
        datasetId: z.string().min(1),
        resourceId: z.string().min(1),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
        filters: z.record(z.string(), z.string()).optional(),
      }),
      execute: async ({ datasetId, resourceId, limit, offset, filters }) => {
        const view = resolveScoped(datasetId);
        if (!view) return { outOfScope: true, datasetId };
        citedDatasetIds.add(view.datasetId);
        const grid =
          filters && Object.keys(filters).length > 0 ? { sort: null, filters } : undefined;
        // Cap the payload so a large artifact can't overflow the model's context window.
        return capResourceContent(bridge.rows(datasetId, resourceId, limit, offset, grid));
      },
    }),
  };

  return { tools, citedDatasetIds };
}
