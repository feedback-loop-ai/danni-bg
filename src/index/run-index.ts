import type { Database } from 'bun:sqlite';
import { withContext } from '../logging/logger.ts';
import { DatasetsRepo } from '../store/repos/datasets.ts';
import type { Embedder } from './embedder.ts';
import { buildFtsRow, deleteFtsRow, upsertFtsRow } from './fts.ts';
import { upsertEmbeddingFor } from './vec.ts';

export interface RunIndexOptions {
  db: Database;
  embedder: Embedder;
  datasetIds?: string[];
  full?: boolean;
}

export interface RunIndexResult {
  ftsUpdated: number;
  vectorsUpdated: number;
}

export async function runIndex(opts: RunIndexOptions): Promise<RunIndexResult> {
  const log = withContext({ component: 'index' });
  const datasets = new DatasetsRepo(opts.db);
  const targets =
    opts.datasetIds && opts.datasetIds.length > 0
      ? opts.datasetIds
          .map((id) => datasets.get(id))
          .filter((row): row is NonNullable<ReturnType<typeof datasets.get>> => row !== null)
      : datasets.listActive();

  if (opts.full) {
    opts.db.exec('DELETE FROM datasets_fts');
  }

  let ftsUpdated = 0;
  let vectorsUpdated = 0;
  for (const ds of targets) {
    if (ds.lifecycle_state !== 'active') {
      deleteFtsRow(opts.db, ds.id);
      continue;
    }
    const row = buildFtsRow(opts.db, ds.id);
    if (!row) continue;
    upsertFtsRow(opts.db, row);
    ftsUpdated++;
    await upsertEmbeddingFor({ db: opts.db, embedder: opts.embedder }, ds.id);
    vectorsUpdated++;
  }

  log.info('index.completed', { ftsUpdated, vectorsUpdated });
  return { ftsUpdated, vectorsUpdated };
}
