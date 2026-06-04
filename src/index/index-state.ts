import type { Database } from 'bun:sqlite';
import { sha256Hex } from '../lib/hash.ts';
import { nowIso } from '../lib/time.ts';
import type { Embedder } from './embedder.ts';
import type { FtsRow } from './fts.ts';

/**
 * One row of the per-dataset incremental-index fingerprint ledger (`index_state`).
 * Reads tolerate NULLs by design (data-model §5.1): a NULL fingerprint means that store
 * has never been written for this dataset, so it must be (re)computed.
 */
export interface IndexStateRow {
  dataset_id: string;
  content_fp: string | null;
  embed_fp: string | null;
  model_id: string | null;
  updated_at: string;
}

/**
 * The fields of an {@link FtsRow} that participate in `content_fp`, in the column order
 * declared by `migrations/003_index.sql` (data-model §2.1). `dataset_id` (UNINDEXED) is
 * intentionally excluded so the fingerprint is identity-independent.
 */
const FTS_FP_FIELDS: ReadonlyArray<Exclude<keyof FtsRow, 'dataset_id'>> = [
  'title_bg',
  'title_en',
  'description_bg',
  'description_en',
  'publisher_label',
  'tag_labels',
  'group_labels',
  'column_labels',
  'entity_labels',
];

/**
 * Serialize an {@link FtsRow} to ordered `label=value\n` lines (one per fingerprinted FTS
 * field, in column order, empties emitted as `label=\n`). Pinned byte layout: a value moving
 * across a field boundary changes the digest, and a tags-only change bumps only `tag_labels`.
 */
export function serializeFtsRow(row: FtsRow): string {
  let out = '';
  for (const field of FTS_FP_FIELDS) {
    out += `${field}=${row[field]}\n`;
  }
  return out;
}

/** SHA-256 (hex) of the serialized FTS field set — the keyword-entry fingerprint. */
export function contentFp(row: FtsRow): string {
  return sha256Hex(serializeFtsRow(row));
}

/**
 * SHA-256 (hex) of the exact `composeEmbeddingText` output — the embedding-input
 * fingerprint. No trimming/reordering/rejoin: whatever bytes were embedded are fingerprinted.
 */
export function embedFp(text: string): string {
  return sha256Hex(text);
}

/**
 * The embedder identity recorded against a stored vector: `"<embedder.id>#<dimension>"`.
 * Re-embed fires when this differs from `index_state.model_id` (FR-004, data-model §2.3).
 */
export function modelIdOf(embedder: Embedder): string {
  return `${embedder.id}#${embedder.dimension}`;
}

/**
 * Access to the `index_state` ledger. Upserts merge per-field so the FTS leg (`content_fp`)
 * and the vector leg (`embed_fp`/`model_id`) can be written independently and one never
 * clobbers the other (FR-003 tags-only; FR-010 transactional write ordering).
 */
export class IndexStateRepo {
  constructor(private readonly db: Database) {}

  get(datasetId: string): IndexStateRow | null {
    return (
      this.db
        .query<IndexStateRow, [string]>('SELECT * FROM index_state WHERE dataset_id = ?')
        .get(datasetId) ?? null
    );
  }

  /** Write `content_fp` (after the FTS upsert), leaving `embed_fp`/`model_id` untouched. */
  upsertContent(datasetId: string, contentFingerprint: string, now: string = nowIso()): void {
    this.db
      .query(
        `INSERT INTO index_state (dataset_id, content_fp, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(dataset_id) DO UPDATE SET content_fp = excluded.content_fp, updated_at = excluded.updated_at`,
      )
      .run(datasetId, contentFingerprint, now);
  }

  /** Write `embed_fp`/`model_id` (after the vector persists), leaving `content_fp` untouched. */
  upsertEmbed(
    datasetId: string,
    embedFingerprint: string,
    modelId: string,
    now: string = nowIso(),
  ): void {
    this.db
      .query(
        `INSERT INTO index_state (dataset_id, embed_fp, model_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(dataset_id) DO UPDATE SET embed_fp = excluded.embed_fp, model_id = excluded.model_id, updated_at = excluded.updated_at`,
      )
      .run(datasetId, embedFingerprint, modelId, now);
  }

  delete(datasetId: string): void {
    this.db.query('DELETE FROM index_state WHERE dataset_id = ?').run(datasetId);
  }

  /** Full scan of indexed dataset ids — the orphan reconciler diffs this against listActive(). */
  listDatasetIds(): string[] {
    return this.db
      .query<{ dataset_id: string }, []>('SELECT dataset_id FROM index_state')
      .all()
      .map((r) => r.dataset_id);
  }
}
