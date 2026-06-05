// Adapts the in-process read API (src/read + src/index/query.ts) to the explorer's view-model
// shapes (T009). The pure projection functions (viewToPointer / viewToDetail / geoEntityIdsOf) hold
// all the reshaping logic and are unit-tested without a DB; ReadBridge binds them to a live store.

import type { Database } from 'bun:sqlite';
import type { Embedder } from '../../../src/index/embedder.ts';
import type { IndexEntry, Lang } from '../../../src/index/query.ts';
import { search, searchByEntity } from '../../../src/index/query.ts';
import type { CuratedDatasetView } from '../../../src/read/dataset-view.ts';
import { datasetView } from '../../../src/read/dataset-view.ts';
import { type ResourceContent, readResourceRows } from '../../../src/read/resource-rows.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import type { DatasetDetailView, DatasetPointer, FreshnessFilter } from './schemas.ts';

/** Geographic entity ids attached to a dataset view (entity ids are namespaced `geo:`). */
export function geoEntityIdsOf(view: CuratedDatasetView): string[] {
  return view.entities.filter((e) => e.entityId.startsWith('geo:')).map((e) => e.entityId);
}

/** Highest geo-link confidence among a view's geo entities (0 when none). */
export function maxGeoConfidence(view: CuratedDatasetView): number {
  const cs = view.entities.filter((e) => e.entityId.startsWith('geo:')).map((e) => e.confidence);
  return cs.length > 0 ? Math.max(...cs) : 0;
}

export function viewToPointer(
  view: CuratedDatasetView,
  score: number | null = null,
): DatasetPointer {
  return {
    datasetId: view.datasetId,
    titleBg: view.title.bg,
    titleEn: view.title.en,
    translationConfidence: view.title.translationConfidence,
    publisher: view.publisher ? { id: view.publisher.id, titleBg: view.publisher.title.bg } : null,
    tags: view.tags,
    freshness: view.freshness,
    geoEntityIds: geoEntityIdsOf(view),
    sourceUrl: view.sourceUrl,
    score,
  };
}

export function viewToDetail(view: CuratedDatasetView): DatasetDetailView {
  return {
    datasetId: view.datasetId,
    titleBg: view.title.bg,
    titleEn: view.title.en,
    descriptionBg: view.description.bg,
    descriptionEn: view.description.en,
    translationConfidence: view.title.translationConfidence,
    publisher: view.publisher ? { id: view.publisher.id, titleBg: view.publisher.title.bg } : null,
    tags: view.tags,
    lifecycleState: view.lifecycleState,
    withdrawnReason: view.withdrawnReason,
    freshness: view.freshness,
    geoEntityIds: geoEntityIdsOf(view),
    resources: view.resources.map((r) => ({
      resourceId: r.resourceId,
      name: r.name,
      kind: r.kind,
      schema: r.schema,
      freshness: r.freshness,
    })),
    entities: view.entities.map((e) => ({
      entityId: e.entityId,
      kind: e.kind,
      labelBg: e.label.bg,
      labelEn: e.label.en,
      confidence: e.confidence,
    })),
    links: view.links.map((l) => ({
      otherDatasetId: l.otherDatasetId,
      viaEntityId: l.viaEntityId,
      confidence: l.confidence,
    })),
    sourceUrl: view.sourceUrl,
  };
}

/** True when a dataset's freshness matches a freshness filter. */
export function matchesFreshness(isStale: boolean, filter: FreshnessFilter): boolean {
  if (filter === 'any') return true;
  return filter === 'stale' ? isStale : !isStale;
}

export interface ReadBridgeDeps {
  db: Database;
  storeRoot: string;
  embedder: Embedder;
  freshnessSloSeconds: number;
}

/** Live binding of the projection logic to a store handle. */
export class ReadBridge {
  constructor(private readonly deps: ReadBridgeDeps) {}

  view(datasetId: string): CuratedDatasetView {
    return datasetView(this.deps.db, datasetId, this.deps.freshnessSloSeconds);
  }

  detail(datasetId: string): DatasetDetailView {
    return viewToDetail(this.view(datasetId));
  }

  rows(datasetId: string, resourceId: string, limit?: number, offset?: number): ResourceContent {
    return readResourceRows(this.deps.db, this.deps.storeRoot, datasetId, resourceId, {
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {}),
    });
  }

  listAllIds(): string[] {
    return new DatasetsRepo(this.deps.db).listAll().map((d) => d.id);
  }

  search(query: string, lang?: Lang, limit?: number): Promise<IndexEntry[]> {
    return search({
      db: this.deps.db,
      embedder: this.deps.embedder,
      query,
      freshnessSloSeconds: this.deps.freshnessSloSeconds,
      ...(lang !== undefined ? { lang } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
  }

  entityDatasets(entityId: string, limit?: number): Promise<IndexEntry[]> {
    return searchByEntity(
      {
        db: this.deps.db,
        embedder: this.deps.embedder,
        query: '',
        freshnessSloSeconds: this.deps.freshnessSloSeconds,
        ...(limit !== undefined ? { limit } : {}),
      },
      entityId,
    );
  }
}
