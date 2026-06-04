import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import { DanniError } from '../../lib/errors.ts';
import { nowIso } from '../../lib/time.ts';
import type { CanonicalScope } from '../../crawler/scope-hash.ts';

/**
 * Repo for the durable crawl checkpoint (004-crawl-checkpoint-resume, data-model §1, §3):
 * `crawl_checkpoints` (one row per scope-hash campaign) + `crawl_checkpoint_datasets`
 * (per-dataset completion) + `crawl_checkpoint_resources` (per-resource completion). Mirrors the
 * other `src/store/repos/*` classes: constructed with a `Database`, reuses `nowIso()`.
 *
 * Persisted JSON columns (`frozen_ids_json`, `scope_json`) are Zod-validated on read; a
 * validation failure surfaces a typed `CheckpointCorruptError` so the planner can degrade to a
 * safe re-scan (FR-008) rather than crash.
 */

/** Thrown when a persisted checkpoint JSON column is missing or fails validation (FR-008). */
export class CheckpointCorruptError extends DanniError {
  override readonly name: string = 'CheckpointCorruptError';
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('CHECKPOINT_CORRUPT', message, details);
  }
}

export interface CrawlCheckpointRow {
  scope_hash: string;
  scope_json: string;
  frozen_ids_json: string;
  cursor_uri: string | null;
  total_datasets: number;
  max_attempts: number;
  status: 'active' | 'completed';
  created_at: string;
  updated_at: string;
  last_run_id: string | null;
  reconciled_at: string | null;
}

export interface CrawlCheckpointDatasetRow {
  scope_hash: string;
  dataset_uri: string;
  validator: string | null;
  outcome: 'pending' | 'complete' | 'failed';
  attempts: number;
  resource_count: number;
  captured_count: number;
  failed_count: number;
  first_seen_at: string;
  last_visited_at: string | null;
  last_failure_reason: string | null;
}

export interface CrawlCheckpointResourceRow {
  scope_hash: string;
  dataset_uri: string;
  resource_uri: string;
  outcome: 'pending' | 'success' | 'failed';
  attempts: number;
  sha256: string | null;
  validator: string | null;
  captured_at: string | null;
  last_failure_reason: string | null;
}

export interface CreateCampaignInput {
  scopeHash: string;
  scopeJson: CanonicalScope;
  frozenIds: string[];
  maxAttempts?: number;
  now?: string;
}

export interface UpsertDatasetInput {
  scopeHash: string;
  datasetUri: string;
  validator?: string | null;
  resourceCount?: number;
  now?: string;
}

export interface UpsertResourceInput {
  scopeHash: string;
  datasetUri: string;
  resourceUri: string;
}

export interface MarkResourceSuccessInput {
  scopeHash: string;
  datasetUri: string;
  resourceUri: string;
  sha256: string;
  validator: string;
  now?: string;
}

export interface MarkResourceFailedInput {
  scopeHash: string;
  datasetUri: string;
  resourceUri: string;
  reason: string;
  now?: string;
}

export interface CampaignCounts {
  total: number;
  discovered: number;
  captured: number;
  failed: number;
}

const FrozenIdsSchema = z.array(z.string().min(1));
const ScopeJsonSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z
    .object({
      publishers: z.array(z.string()),
      categories: z.array(z.string()),
      tags: z.array(z.string()),
      datasetIds: z.array(z.string()),
    })
    .strict(),
]);

export class CrawlCheckpointsRepo {
  constructor(private readonly db: Database) {}

  getCampaign(scopeHash: string): CrawlCheckpointRow | null {
    return (
      this.db
        .query<CrawlCheckpointRow, [string]>('SELECT * FROM crawl_checkpoints WHERE scope_hash = ?')
        .get(scopeHash) ?? null
    );
  }

  /** All active campaigns, newest first (drives `danni status` progress — FR-006). */
  listActive(): CrawlCheckpointRow[] {
    return this.db
      .query<CrawlCheckpointRow, []>(
        "SELECT * FROM crawl_checkpoints WHERE status = 'active' ORDER BY updated_at DESC",
      )
      .all();
  }

  createCampaign(input: CreateCampaignInput): CrawlCheckpointRow {
    const now = input.now ?? nowIso();
    this.db
      .query(
        `INSERT INTO crawl_checkpoints (scope_hash, scope_json, frozen_ids_json, cursor_uri, total_datasets, max_attempts, status, created_at, updated_at, last_run_id, reconciled_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'active', ?, ?, NULL, NULL)`,
      )
      .run(
        input.scopeHash,
        JSON.stringify(input.scopeJson),
        JSON.stringify(input.frozenIds),
        input.frozenIds.length,
        input.maxAttempts ?? 3,
        now,
        now,
      );
    return this.getCampaign(input.scopeHash) as CrawlCheckpointRow;
  }

  deleteCampaign(scopeHash: string): void {
    this.db.query('DELETE FROM crawl_checkpoints WHERE scope_hash = ?').run(scopeHash);
  }

  /** Frozen sorted dataset-uri list (Zod-validated on read). */
  frozenIds(scopeHash: string): string[] {
    const c = this.getCampaign(scopeHash);
    if (!c) {
      throw new CheckpointCorruptError('checkpoint campaign not found', { scopeHash });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(c.frozen_ids_json);
    } catch (err) {
      throw new CheckpointCorruptError('frozen_ids_json is not valid JSON', {
        scopeHash,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const result = FrozenIdsSchema.safeParse(parsed);
    if (!result.success) {
      throw new CheckpointCorruptError('frozen_ids_json failed validation', {
        scopeHash,
        issues: result.error.issues.map((i) => i.message),
      });
    }
    return result.data;
  }

  /** Canonical scope object (Zod-validated on read). */
  scope(scopeHash: string): CanonicalScope {
    const c = this.getCampaign(scopeHash);
    if (!c) {
      throw new CheckpointCorruptError('checkpoint campaign not found', { scopeHash });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(c.scope_json);
    } catch (err) {
      throw new CheckpointCorruptError('scope_json is not valid JSON', {
        scopeHash,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const result = ScopeJsonSchema.safeParse(parsed);
    if (!result.success) {
      throw new CheckpointCorruptError('scope_json failed validation', {
        scopeHash,
        issues: result.error.issues.map((i) => i.message),
      });
    }
    return result.data;
  }

  /** Append newly discovered uris to the frozen list (never reorders — data-model §1.1). */
  appendFrozenIds(scopeHash: string, newUris: string[], now: string = nowIso()): void {
    const existing = this.frozenIds(scopeHash);
    const seen = new Set(existing);
    const merged = [...existing];
    for (const uri of newUris) {
      if (!seen.has(uri)) {
        seen.add(uri);
        merged.push(uri);
      }
    }
    this.db
      .query(
        'UPDATE crawl_checkpoints SET frozen_ids_json = ?, total_datasets = ?, reconciled_at = ?, updated_at = ? WHERE scope_hash = ?',
      )
      .run(JSON.stringify(merged), merged.length, now, now, scopeHash);
  }

  advanceCursor(scopeHash: string, cursorUri: string, runId: string, now: string = nowIso()): void {
    this.db
      .query(
        'UPDATE crawl_checkpoints SET cursor_uri = ?, last_run_id = ?, updated_at = ? WHERE scope_hash = ?',
      )
      .run(cursorUri, runId, now, scopeHash);
  }

  markCampaignCompleted(scopeHash: string, now: string = nowIso()): void {
    this.db
      .query("UPDATE crawl_checkpoints SET status = 'completed', updated_at = ? WHERE scope_hash = ?")
      .run(now, scopeHash);
  }

  markCampaignActive(scopeHash: string, now: string = nowIso()): void {
    this.db
      .query("UPDATE crawl_checkpoints SET status = 'active', updated_at = ? WHERE scope_hash = ?")
      .run(now, scopeHash);
  }

  // ---- per-dataset ----

  getDataset(scopeHash: string, datasetUri: string): CrawlCheckpointDatasetRow | null {
    return (
      this.db
        .query<CrawlCheckpointDatasetRow, [string, string]>(
          'SELECT * FROM crawl_checkpoint_datasets WHERE scope_hash = ? AND dataset_uri = ?',
        )
        .get(scopeHash, datasetUri) ?? null
    );
  }

  upsertDataset(input: UpsertDatasetInput): void {
    const now = input.now ?? nowIso();
    const existing = this.getDataset(input.scopeHash, input.datasetUri);
    if (!existing) {
      this.db
        .query(
          `INSERT INTO crawl_checkpoint_datasets (scope_hash, dataset_uri, validator, outcome, attempts, resource_count, captured_count, failed_count, first_seen_at, last_visited_at, last_failure_reason)
           VALUES (?, ?, ?, 'pending', 0, ?, 0, 0, ?, ?, NULL)`,
        )
        .run(
          input.scopeHash,
          input.datasetUri,
          input.validator ?? null,
          input.resourceCount ?? 0,
          now,
          now,
        );
      return;
    }
    this.db
      .query(
        'UPDATE crawl_checkpoint_datasets SET validator = ?, resource_count = ?, last_visited_at = ? WHERE scope_hash = ? AND dataset_uri = ?',
      )
      .run(
        input.validator ?? existing.validator,
        input.resourceCount ?? existing.resource_count,
        now,
        input.scopeHash,
        input.datasetUri,
      );
  }

  markDatasetComplete(scopeHash: string, datasetUri: string, now: string = nowIso()): void {
    this.db
      .query(
        "UPDATE crawl_checkpoint_datasets SET outcome = 'complete', last_visited_at = ?, last_failure_reason = NULL WHERE scope_hash = ? AND dataset_uri = ?",
      )
      .run(now, scopeHash, datasetUri);
  }

  markDatasetFailed(
    scopeHash: string,
    datasetUri: string,
    reason: string,
    now: string = nowIso(),
  ): void {
    this.db
      .query(
        "UPDATE crawl_checkpoint_datasets SET outcome = 'failed', attempts = attempts + 1, last_visited_at = ?, last_failure_reason = ? WHERE scope_hash = ? AND dataset_uri = ?",
      )
      .run(now, reason, scopeHash, datasetUri);
  }

  reopenDataset(scopeHash: string, datasetUri: string, now: string = nowIso()): void {
    this.db
      .query(
        "UPDATE crawl_checkpoint_datasets SET outcome = 'pending', last_visited_at = ? WHERE scope_hash = ? AND dataset_uri = ?",
      )
      .run(now, scopeHash, datasetUri);
  }

  // ---- per-resource ----

  getResource(
    scopeHash: string,
    datasetUri: string,
    resourceUri: string,
  ): CrawlCheckpointResourceRow | null {
    return (
      this.db
        .query<CrawlCheckpointResourceRow, [string, string, string]>(
          'SELECT * FROM crawl_checkpoint_resources WHERE scope_hash = ? AND dataset_uri = ? AND resource_uri = ?',
        )
        .get(scopeHash, datasetUri, resourceUri) ?? null
    );
  }

  listResources(scopeHash: string, datasetUri: string): CrawlCheckpointResourceRow[] {
    return this.db
      .query<CrawlCheckpointResourceRow, [string, string]>(
        'SELECT * FROM crawl_checkpoint_resources WHERE scope_hash = ? AND dataset_uri = ? ORDER BY resource_uri',
      )
      .all(scopeHash, datasetUri);
  }

  upsertResource(input: UpsertResourceInput): void {
    const existing = this.getResource(input.scopeHash, input.datasetUri, input.resourceUri);
    if (existing) return;
    this.db
      .query(
        `INSERT INTO crawl_checkpoint_resources (scope_hash, dataset_uri, resource_uri, outcome, attempts, sha256, validator, captured_at, last_failure_reason)
         VALUES (?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL)`,
      )
      .run(input.scopeHash, input.datasetUri, input.resourceUri);
  }

  markResourceSuccess(input: MarkResourceSuccessInput): void {
    const now = input.now ?? nowIso();
    this.db
      .query(
        "UPDATE crawl_checkpoint_resources SET outcome = 'success', sha256 = ?, validator = ?, captured_at = ?, last_failure_reason = NULL WHERE scope_hash = ? AND dataset_uri = ? AND resource_uri = ?",
      )
      .run(input.sha256, input.validator, now, input.scopeHash, input.datasetUri, input.resourceUri);
  }

  markResourceFailed(input: MarkResourceFailedInput): void {
    this.db
      .query(
        "UPDATE crawl_checkpoint_resources SET outcome = 'failed', attempts = attempts + 1, last_failure_reason = ? WHERE scope_hash = ? AND dataset_uri = ? AND resource_uri = ?",
      )
      .run(input.reason, input.scopeHash, input.datasetUri, input.resourceUri);
  }

  // ---- progress / retry accounting (FR-006, FR-009) ----

  counts(scopeHash: string): CampaignCounts {
    const total = this.getCampaign(scopeHash)?.total_datasets ?? 0;
    const row = this.db
      .query<{ discovered: number; captured: number; failed: number }, [string]>(
        `SELECT
           COUNT(*) AS discovered,
           SUM(CASE WHEN outcome = 'complete' THEN 1 ELSE 0 END) AS captured,
           SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM crawl_checkpoint_datasets WHERE scope_hash = ?`,
      )
      .get(scopeHash);
    return {
      total,
      discovered: row?.discovered ?? 0,
      captured: row?.captured ?? 0,
      failed: row?.failed ?? 0,
    };
  }

  /**
   * In-scope datasets not yet `complete`, EXCLUDING capped failures (attempts >= max_attempts).
   * Frozen ids without a dataset row yet (not visited) count as remaining (FR-006, FR-009).
   */
  remaining(scopeHash: string): number {
    const c = this.getCampaign(scopeHash);
    if (!c) return 0;
    const row = this.db
      .query<{ done_or_capped: number }, [string, number]>(
        `SELECT COUNT(*) AS done_or_capped FROM crawl_checkpoint_datasets
         WHERE scope_hash = ?
           AND (outcome = 'complete' OR (outcome = 'failed' AND attempts >= ?))`,
      )
      .get(scopeHash, c.max_attempts);
    return c.total_datasets - (row?.done_or_capped ?? 0);
  }

  /** Failed datasets still under the attempt cap (re-opened only with --retry-failed). */
  listRetryableFailed(scopeHash: string): string[] {
    const c = this.getCampaign(scopeHash);
    if (!c) return [];
    return this.db
      .query<{ dataset_uri: string }, [string, number]>(
        "SELECT dataset_uri FROM crawl_checkpoint_datasets WHERE scope_hash = ? AND outcome = 'failed' AND attempts < ? ORDER BY dataset_uri",
      )
      .all(scopeHash, c.max_attempts)
      .map((r) => r.dataset_uri);
  }
}
