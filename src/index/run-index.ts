import type { Database } from 'bun:sqlite';
import { withContext } from '../logging/logger.ts';
import { withTransaction } from '../store/db.ts';
import { type DatasetRow, DatasetsRepo } from '../store/repos/datasets.ts';
import type { Embedder } from './embedder.ts';
import {
  deleteEmbedding,
  ensureEmbeddingsTable,
  getEmbeddingsMeta,
  setEmbeddingsMeta,
  upsertEmbedding,
} from './embeddings-store.ts';
import { type FtsRow, buildFtsRow, deleteFtsRow, upsertFtsRow } from './fts.ts';
import { IndexStateRepo, contentFp, embedFp, modelIdOf } from './index-state.ts';
import { composeEmbeddingText } from './vec.ts';

export interface RunIndexOptions {
  db: Database;
  embedder: Embedder;
  datasetIds?: string[];
  full?: boolean;
  /** Incremental skip gate enabled when truthy/undefined; `--full` overrides this. */
  incremental?: boolean;
}

export interface RunIndexResult {
  ftsUpdated: number;
  vectorsUpdated: number;
  /** Datasets embedded because content changed / new / presence-guard (FR-007). */
  embedded: number;
  /** Datasets whose FTS+vector were both skipped this run (FR-007). */
  skippedUnchanged: number;
  /** Datasets re-embedded solely because the embedder identity changed (FR-007). */
  reembeddedDueToModelChange: number;
  /** Datasets purged from the index because they are no longer active (FR-006/FR-007). */
  purged: number;
}

function ftsRowPresent(db: Database, datasetId: string): boolean {
  return (
    db
      .query<{ one: number }, [string]>('SELECT 1 AS one FROM datasets_fts WHERE dataset_id = ?')
      .get(datasetId) !== null
  );
}

function embeddingRowPresent(db: Database, datasetId: string): boolean {
  return (
    db
      .query<{ one: number }, [string]>(
        'SELECT 1 AS one FROM dataset_embeddings WHERE dataset_id = ?',
      )
      .get(datasetId) !== null
  );
}

interface Counters {
  ftsUpdated: number;
  vectorsUpdated: number;
  embedded: number;
  skippedUnchanged: number;
  reembeddedDueToModelChange: number;
  purged: number;
}

/**
 * Full force-rebuild (FR-005, research.md R7): clear all three stores then re-derive every
 * active dataset's FTS row, vector and fresh index_state — all in one transaction, ignoring the
 * skip gate. Not a bare FTS DELETE: it also clears dataset_embeddings and index_state so vectors
 * from a prior model can never survive a `--full`.
 */
async function rebuildFull(
  opts: RunIndexOptions,
  active: DatasetRow[],
  currentModelId: string,
  c: Counters,
): Promise<void> {
  const db = opts.db;
  ensureEmbeddingsTable(db);
  const indexState = new IndexStateRepo(db);
  // Embed outside the write transaction (the embedder may be async/hosted); collect the work,
  // then commit all store writes atomically.
  const work: Array<{ row: FtsRow; vector: Float32Array | null }> = [];
  for (const ds of active) {
    const row = buildFtsRow(db, ds.id);
    if (!row) continue;
    const text = composeEmbeddingText(db, ds.id);
    let vector: Float32Array | null = null;
    if (text.trim() !== '') {
      const [vec] = await opts.embedder.embed([text]);
      vector = vec ?? null;
    }
    work.push({ row, vector });
  }
  withTransaction(db, () => {
    db.exec('DELETE FROM datasets_fts');
    db.exec('DELETE FROM dataset_embeddings');
    db.exec('DELETE FROM index_state');
    for (const { row, vector } of work) {
      upsertFtsRow(db, row);
      indexState.upsertContent(row.dataset_id, contentFp(row));
      c.ftsUpdated++;
      if (vector) {
        upsertEmbedding(db, row.dataset_id, vector);
        indexState.upsertEmbed(
          row.dataset_id,
          embedFp(composeEmbeddingText(db, row.dataset_id)),
          currentModelId,
        );
        c.vectorsUpdated++;
        c.embedded++;
      }
    }
  });
}

export async function runIndex(opts: RunIndexOptions): Promise<RunIndexResult> {
  const log = withContext({ component: 'index' });
  const db = opts.db;
  const datasets = new DatasetsRepo(db);
  const indexState = new IndexStateRepo(db);
  ensureEmbeddingsTable(db);

  const incremental = !opts.full && (opts.incremental ?? true);

  // Record the global embedder identity once at run start (research.md R8). The per-dataset
  // re-embed decision reads index_state.model_id, not this global marker, so a partial model
  // switch still converges; but the global marker is kept current for read consumers.
  const currentModelId = modelIdOf(opts.embedder);
  const meta = getEmbeddingsMeta(db);
  if (meta.model_id !== opts.embedder.id || meta.dimension !== opts.embedder.dimension) {
    setEmbeddingsMeta(db, opts.embedder.id, opts.embedder.dimension);
  }

  const active = datasets.listActive();

  const c: Counters = {
    ftsUpdated: 0,
    vectorsUpdated: 0,
    embedded: 0,
    skippedUnchanged: 0,
    reembeddedDueToModelChange: 0,
    purged: 0,
  };

  if (opts.full) {
    await rebuildFull(opts, active, currentModelId, c);
    reconcileOrphans(db, datasets, indexState, c);
    log.info('index.completed', { ...c, mode: 'full' });
    return { ...c };
  }

  // Resolve the recompute targets. A --datasets subset limits ONLY which datasets are
  // recomputed; the orphan purge below still runs full-corpus (FR-006).
  const targets =
    opts.datasetIds && opts.datasetIds.length > 0
      ? opts.datasetIds
          .map((id) => datasets.get(id))
          .filter((row): row is DatasetRow => row !== null && row.lifecycle_state === 'active')
      : active;

  for (const ds of targets) {
    const row = buildFtsRow(db, ds.id);
    if (!row) continue;
    const state = indexState.get(ds.id);

    // --- Decide the changed/selected set (SEAM 002: this decision stays separate from the
    //     "embed the set" step so 002 can batch the vector leg without rewriting the gate). ---
    const currentContentFp = contentFp(row);
    const text = composeEmbeddingText(db, ds.id);
    const currentEmbedFp = embedFp(text);

    const ftsSkip =
      incremental && state?.content_fp === currentContentFp && ftsRowPresent(db, ds.id);
    const hasText = text.trim() !== '';
    const embedMatches = state?.embed_fp === currentEmbedFp && state.model_id === currentModelId;
    const vecSkip = incremental && hasText && embedMatches && embeddingRowPresent(db, ds.id);

    if (ftsSkip && (vecSkip || !hasText)) {
      // Nothing to do for this dataset. (Empty-text datasets never carry a vector; once their
      // FTS row is current they are "unchanged".)
      c.skippedUnchanged++;
      continue;
    }

    // Pure model change vs content change (count-precedence, data-model §3): only a matching
    // embed_fp with a differing model_id is a "model change"; any embed_fp mismatch/NULL means
    // content changed and is counted as `embedded` even if the model also changed.
    const pureModelChange =
      incremental &&
      hasText &&
      !vecSkip &&
      state?.embed_fp === currentEmbedFp &&
      embeddingRowPresent(db, ds.id) &&
      state.model_id !== currentModelId;

    // Embed (the async vector work) happens before the per-dataset transaction so the commit
    // window stays small. FTS is cheap and stays inside the transaction.
    let vector: Float32Array | null = null;
    if (!vecSkip && hasText) {
      vector = await persistVectorOutOfTx(opts.embedder, text);
    }

    withTransaction(db, () => {
      if (!ftsSkip) {
        upsertFtsRow(db, row);
        indexState.upsertContent(ds.id, currentContentFp);
        c.ftsUpdated++;
      }
      if (!vecSkip && hasText && vector) {
        upsertEmbedding(db, ds.id, vector);
        indexState.upsertEmbed(ds.id, currentEmbedFp, currentModelId);
        c.vectorsUpdated++;
        if (pureModelChange) {
          c.reembeddedDueToModelChange++;
        } else {
          c.embedded++;
        }
      }
    });
  }

  reconcileOrphans(db, datasets, indexState, c);

  log.info('index.completed', { ...c, mode: 'incremental' });
  return { ...c };
}

/** Embed a single text outside any write transaction (keeps the commit window small). */
async function persistVectorOutOfTx(
  embedder: Embedder,
  text: string,
): Promise<Float32Array | null> {
  const [vec] = await embedder.embed([text]);
  return vec ?? null;
}

/**
 * Every-run orphan reconcile (FR-006, SC-004): delete every index row whose dataset_id is not in
 * listActive() from all index stores. Runs full-corpus even under a --datasets subset.
 *
 * SEAM (002): written set-difference-driven so adding 002's `index_failures` as a 4th store to
 * purge is a one-line extension (plan.md §Cross-Spec Coordination).
 */
function reconcileOrphans(
  db: Database,
  datasets: DatasetsRepo,
  indexState: IndexStateRepo,
  c: Counters,
): void {
  const activeIds = new Set(datasets.listActive().map((d) => d.id));
  const ftsIds = db
    .query<{ dataset_id: string }, []>('SELECT dataset_id FROM datasets_fts')
    .all()
    .map((r) => r.dataset_id);
  const embedIds = db
    .query<{ dataset_id: string }, []>('SELECT dataset_id FROM dataset_embeddings')
    .all()
    .map((r) => r.dataset_id);
  const stateIds = indexState.listDatasetIds();

  const purged = new Set<string>();
  for (const id of new Set([...ftsIds, ...embedIds, ...stateIds])) {
    if (activeIds.has(id)) continue;
    deleteFtsRow(db, id);
    deleteEmbedding(db, id);
    indexState.delete(id);
    purged.add(id);
  }
  c.purged += purged.size;
}
