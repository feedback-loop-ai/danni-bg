# Data Model — 002-batch-embedding

**Date**: 2026-06-03
**Scope**: One new SQLite table (`index_failures`), one config-schema delta
(`enrichment.embedder.batchSize` / `maxBatchSize`), and the extended in-memory
run-result / batch-result shapes. No change to the stored vector format
(`dataset_embeddings` BLOB) and no on-disk blob-layout change.

> **Conventions** (inherited from 001): `snake_case` SQL identifiers;
> `kebab-case` file paths; `camelCase` TypeScript/JSON fields. Timestamps are
> ISO-8601 UTC `TEXT` (e.g. `2026-06-03T22:00:00.000Z`) via `nowIso()`.

---

## 1. New table: `index_failures`

Persists the **current** per-dataset "not-embedded" reason for inspection
(FR-008). Keyed by `dataset_id` so it is a current snapshot (upsert), never an
append-only log. Cleared for a dataset once it embeds successfully.

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `dataset_id` | TEXT | PRIMARY KEY | The dataset left un-embedded. Not a FK — kept resilient to lifecycle churn, mirroring `sync_run_events.dataset_id` (data-model 001 §1.5). |
| `reason` | TEXT | NOT NULL | Machine-readable reason code + detail (see §1.1). |
| `updated_at` | TEXT | NOT NULL | ISO-8601 UTC of the most recent failure record for this dataset. |

**Indexes**: PRIMARY KEY on `dataset_id` suffices (lookups are by id; the table
is small — at most the count of currently-failing datasets). No secondary index.

**Write semantics** (in `IndexFailuresRepo`):
- `record(datasetId, reason, now=nowIso())` → `INSERT OR REPLACE` (upsert by
  `dataset_id`); a re-failure overwrites the prior reason and bumps `updated_at`.
- `clear(datasetId)` → `DELETE FROM index_failures WHERE dataset_id = ?`; called
  the moment a dataset's vector is successfully persisted (FR-008).
- `list()` → `SELECT * ORDER BY dataset_id` (for `danni index` inspection /
  tooling).

**Separation from 003** (cross-feature, binding): this table is **distinct** from
003-incremental-indexing's `index_state(dataset_id, content_fp, embed_fp,
model_id)`. `index_state` drives *skipping*; `index_failures` records *failures*
for inspection. No shared rows, no FK between them, and 003's skip logic MUST NOT
read `index_failures`.

### 1.1 `reason` taxonomy

The reason is a short stable code optionally followed by `:` and detail. Proposed
codes (the batcher emits exactly one per recorded dataset):

| Code | Emitted when | FR |
|---|---|---|
| `empty_text` | Composed embedding text is empty/whitespace and excluded from batching | FR-007 |
| `single_text_failed:<detail>` | The dataset's text failed even on the single-text retry after a batch fault | FR-004 |
| `transient_exhausted:<status>` | The single-text retry hit a 429/5xx that exhausted the backoff budget | FR-009 |

> `empty_text` rows are also counted in the run result's `skippedEmpty` (not
> `failed`), but are still persisted here because the Key-Entities "Not-embedded
> record" explicitly includes empty-text datasets. Implementers MAY gate
> empty-text persistence behind a flag if product later wants `index_failures` to
> hold only true failures; the spec's Key-Entities text persists both, so the
> default is: persist `empty_text` too.

---

## 2. Config-schema delta — `enrichment.embedder`

Extend `EmbedderConfigSchema` (`src/config/schema.ts:110`). New fields only;
existing fields (`provider`, `modelId`, `endpointUrl`, `apiKeyEnv`) unchanged.

| Field | Zod | Default | Notes |
|---|---|---|---|
| `batchSize` | `z.number().int().min(1).max(256)` | `32` | FR-002 / clarification Q2: default 32, range 1–256. |
| `maxBatchSize` | `z.number().int().min(1).max(256).nullable().optional()` | unset | Optional provider-request cap. `maxBatchSize === 1` may also be declared by a provider (R3) to force single-text mode. |

**Effective batch size** (computed at index time, not stored):

```
effectiveBatchSize = min(
  config.enrichment.embedder.batchSize,
  config.enrichment.embedder.maxBatchSize ?? Infinity,
  embedder.maxBatchSize ?? Infinity            // provider capability (R3)
)
```

No cap is applied when both `maxBatchSize` (config) and the provider cap are
unset (FR-002). Validated at config load — fail-fast on out-of-range
(Principle VII).

**Example config fragment:**

```json
{
  "enrichment": {
    "embedder": {
      "provider": "hosted-api",
      "endpointUrl": "https://api.example.com/v1/embeddings",
      "apiKeyEnv": "EMBED_API_KEY",
      "modelId": "text-embedding-3-small",
      "batchSize": 64,
      "maxBatchSize": 128
    }
  }
}
```

---

## 3. Embedder interface delta

`src/index/embedder.ts` — add an **optional** capability signal; `embed()`
signature is unchanged (already `embed(texts: string[]) => Promise<Float32Array[]>`).

```ts
export interface Embedder {
  readonly id: string;
  readonly dimension: number;
  readonly maxBatchSize?: number;            // NEW (R3): === 1 forces single-text mode
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

`HostedApiEmbedder` and `LocalOnnxEmbedder` accept an optional `maxBatchSize`
constructor option and surface it. The stub leaves it unset so CI exercises real
multi-text batching.

---

## 4. In-memory result shapes (no persistence)

### 4.1 `BatchEmbedResult` (returned by `src/index/batch-embed.ts`)

```ts
export interface NotEmbedded {
  datasetId: string;
  reason: string;          // §1.1 taxonomy
}

export interface BatchEmbedResult {
  embedded: number;          // datasets that got a vector this run
  embedderRequests: number;  // EVERY embedder invocation, incl. single-text retries
                             //   and forced-single calls (round-2 Q3)
  skippedEmpty: number;      // datasets excluded for empty composed text (FR-007)
  failed: number;            // datasets still un-embedded after single-text retry
  failures: NotEmbedded[];   // in-memory mirror of the persisted index_failures rows
}
```

> SC-001's `embedderRequests === ⌈N / effectiveBatchSize⌉` holds **only on the
> happy path** (no retries). Single-text retries and forced-single requests each
> increment `embedderRequests` (round-2 Q3).

### 4.2 Extended `RunIndexResult` (`src/index/run-index.ts`)

Existing fields kept; embedding counts added by merging the `BatchEmbedResult`:

```ts
export interface RunIndexResult {
  ftsUpdated: number;        // existing (FTS upserts, per-dataset, outside batching)
  vectorsUpdated: number;    // existing; == BatchEmbedResult.embedded
  embedded: number;          // NEW (FR-008)
  embedderRequests: number;  // NEW (FR-008)
  skippedEmpty: number;      // NEW (FR-008)
  failed: number;            // NEW (FR-008)
  failures: NotEmbedded[];   // NEW (FR-008)
}
```

---

## 5. Proposed migration

**File**: `migrations/004_index_failures.sql`
**Proposed prefix**: `004` — the next free number after the applied set
`001_core`, `002_curate_enrich`, `003_index`.

> ⚠️ **MIGRATION-NUMBER COORDINATION (release-blocking).** Features
> **002-batch-embedding** (`index_failures`), **003-incremental-indexing**
> (`index_state`), and **004-crawl-checkpoint-resume** (`crawl_checkpoint`) are
> being planned in parallel from the same `003_index` baseline and would **each
> claim `004`**. The runner `src/store/migrate.ts` (`discoverMigrations`) keys
> applied state by the integer prefix and **checksum-guards already-applied
> files**, so two `004_*.sql` files — or reusing `004` after it ships — is a hard
> error. Assign distinct ascending prefixes in merge order (e.g. first-merged →
> `004`, next → `005`, next → `006`) and update the chosen filename accordingly.
> This migration creates only `index_failures`; it is independent of `index_state`
> and `crawl_checkpoint` and can take any free prefix.

**What it creates** (DDL, exact):

```sql
-- 004_index_failures.sql — per-dataset "not-embedded" reasons for the vector
-- index (002-batch-embedding, FR-008). Current snapshot keyed by dataset_id;
-- cleared when a dataset embeds successfully. Kept SEPARATE from
-- 003-incremental-indexing's index_state.

CREATE TABLE index_failures (
  dataset_id TEXT PRIMARY KEY,
  reason     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

No data seed. No index beyond the implicit PRIMARY KEY. Forward-only, applied by
the existing runner inside a transaction with a checksum record (no change to
`src/store/migrate.ts`).

---

## 6. Validation rules (Principle VII boundaries touched)

1. **Config load** (`src/config/schema.ts`): `batchSize` (1–256) and
   `maxBatchSize` (1–256, optional) Zod-validated at startup; out-of-range fails
   fast.
2. **Embedder response** (`src/index/batch-embed.ts`): positional length check —
   `returned.length === input.length` asserted per batch (FR-003); mismatch
   raises a typed batch-fault that triggers the single-text retry, never a silent
   mis-map.
3. **Persisted-record load** (`src/store/repos/index-failures.ts`): rows are
   typed (`{dataset_id, reason, updated_at}`); `reason` is free TEXT but the
   batcher only writes the §1.1 taxonomy.

---

## 7. Relationship to existing tables

```
datasets (1) ──< dataset_embeddings        (existing; vector BLOB — unchanged)
datasets (1) ──< index_failures            (NEW; current not-embedded reason)

embeddings_meta (single row)               (existing; model id + dimension — unchanged)

-- 003 (separate feature): datasets (1) ──< index_state  ← NOT shared with index_failures
```

`index_failures.dataset_id` is intentionally **not** a foreign key (resilient to
withdrawn/out-of-scope churn, like `sync_run_events`). A successful embed in a
later run clears the row; an orphan-purge for non-active datasets is owned by 003
(`index_state` reconciliation) and MAY be extended to also clear `index_failures`
when 003 lands — recorded here as a cross-feature touchpoint, not built by 002.
</content>
