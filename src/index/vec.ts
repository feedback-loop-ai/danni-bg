import type { Database } from 'bun:sqlite';
import { DatasetsRepo } from '../store/repos/datasets.ts';
import { EntitiesRepo } from '../store/repos/entities.ts';
import { TranslationsRepo } from '../store/repos/translations.ts';
import type { Embedder } from './embedder.ts';
import {
  ensureEmbeddingsTable,
  getEmbeddingsMeta,
  setEmbeddingsMeta,
  upsertEmbedding,
} from './embeddings-store.ts';

export interface VecBuilderOptions {
  db: Database;
  embedder: Embedder;
}

export function composeEmbeddingText(db: Database, datasetId: string): string {
  const ds = new DatasetsRepo(db).get(datasetId);
  if (!ds) return '';
  const tx = new TranslationsRepo(db);
  const titleEn = tx.forSubject('dataset_title', datasetId)[0]?.text_en ?? '';
  const descEn = tx.forSubject('dataset_description', datasetId)[0]?.text_en ?? '';
  const entityLabels = new EntitiesRepo(db)
    .entitiesForDataset(datasetId)
    .flatMap((e) => [e.canonical_label_bg, e.canonical_label_en ?? ''])
    .filter((s) => s.length > 0)
    .join(' ');
  return [ds.title_bg, titleEn, ds.description_bg ?? '', descEn, entityLabels]
    .filter((s) => s.length > 0)
    .join('\n');
}

export async function upsertEmbeddingFor(
  opts: VecBuilderOptions,
  datasetId: string,
): Promise<void> {
  ensureEmbeddingsTable(opts.db);
  const text = composeEmbeddingText(opts.db, datasetId);
  if (text.trim() === '') return;
  const [vec] = await opts.embedder.embed([text]);
  if (!vec) return;
  upsertEmbedding(opts.db, datasetId, vec);
  const meta = getEmbeddingsMeta(opts.db);
  if (meta.model_id !== opts.embedder.id || meta.dimension !== opts.embedder.dimension) {
    setEmbeddingsMeta(opts.db, opts.embedder.id, opts.embedder.dimension);
  }
}
