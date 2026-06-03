# Data Model — 003-incremental-indexing

**Date**: 2026-06-03
**Scope**: One new SQLite table (`index_state`) that records, per dataset, the
fingerprints and embedder identity behind the *currently stored* index rows, plus
the fingerprint serialization contract. No new on-disk blob layout; no new config.
The `config.index.incremental` toggle this feature relies on already exists in
`src/config/schema.ts` (`IndexConfigSchema`) — it is documented here for completeness
but not changed.

> **Naming convention** (inherited from 001): `snake_case` SQL identifiers;
> `kebab-case` file paths; `camelCase` TypeScript fields. Timestamps are ISO-8601
> UTC `TEXT` via `nowIso()` (`src/lib/time.ts`).

---

## 1. New table

### 1.1 `index_state` — per-dataset index fingerprint ledger

The durable skip ledger. One row per dataset that has been (or is being) indexed.
Separate from `embeddings_meta` (global, single-row) and from feature 002's
`index_failures` (transient, cleared on success).

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `dataset_id` | TEXT | PRIMARY KEY REFERENCES `datasets(id)` | The dataset this state describes |
| `content_fp` | TEXT | | SHA-256 (hex) of the serialized FTS field set; NULL until the FTS row is first written |
| `embed_fp` | TEXT | | SHA-256 (hex) of the exact `composeEmbeddingText` output; NULL until a vector is first persisted |
| `model_id` | TEXT | | Embedder identity that produced the stored vector, `"<embedder.id>#<dimension>"`; NULL until a vector is first persisted |
| `updated_at` | TEXT | NOT NULL | Last write to this row (ISO-8601 UTC) |

**Indexes**: PRIMARY KEY on `dataset_id` is the only access path needed (all reads
are point lookups keyed by `dataset_id`; the orphan reconciler does a full
`SELECT dataset_id FROM index_state` scan, which needs no secondary index).

**Foreign key**: `dataset_id REFERENCES datasets(id)`. `datasets` rows are never
deleted (data-model 001 §1.1 invariant — withdrawn datasets keep their row), so the
FK never dangles. The orphan purge deletes `index_state` rows by `dataset_id` for
datasets whose `lifecycle_state != 'active'`; it does **not** rely on FK cascade.

**Invariants** (enforced in code, mirrored from FR-010 / R5):
- `content_fp` is written **only after** the matching `datasets_fts` row is upserted,
  in the same per-dataset transaction.
- `embed_fp` and `model_id` are written **only after** the matching
  `dataset_embeddings` row is persisted, in the same per-dataset transaction.
- A partial update is allowed: a tags-only change rewrites `content_fp` (+`updated_at`)
  and leaves `embed_fp`/`model_id` intact (FR-003). The upsert merges per-field.
- The three fields can be NULL independently; a NULL or mismatched fingerprint, or a
  missing corresponding store row, forces recompute of that store (FR-001).

**Why these three columns and no more**: the spec's `index_state` entity is exactly
`(dataset_id, content_fp, embed_fp, model_id)` (Key Entities + FR-003). `updated_at`
is added for operability/debuggability only (consistent with every other table in
data-model 001 carrying a timestamp) and is not part of any skip decision.

---

## 2. Fingerprint serialization contract

These are code contracts (not SQL), pinned here because the exact byte layout is
load-bearing for skip correctness and cross-release stability (FR-003, edge case
"fingerprint scheme changes between releases").

### 2.1 `content_fp`

Input: the typed `FtsRow` produced by `buildFtsRow` (`src/index/fts.ts`).
Serialization: ordered `label=value\n` lines, one per FtsRow field **excluding**
`dataset_id`, in the FTS column order declared by `migrations/003_index.sql`:

```
title_bg=<value>\n
title_en=<value>\n
description_bg=<value>\n
description_en=<value>\n
publisher_label=<value>\n
tag_labels=<value>\n
group_labels=<value>\n
column_labels=<value>\n
entity_labels=<value>\n
```

Empty fields are emitted with an empty value (the line is still present), so a value
moving across a field boundary changes the digest. `content_fp = sha256Hex(serialized)`
using `sha256Hex` (`src/lib/hash.ts`).

### 2.2 `embed_fp`

Input: the exact string returned by `composeEmbeddingText(db, datasetId)`
(`src/index/vec.ts`) — no re-ordering, trimming, or re-join applied by the
fingerprinter. `embed_fp = sha256Hex(composeEmbeddingText(...))`.

**Consequence (verified against the code paths)**: a tags-only change mutates
`tag_labels` in the FtsRow (so `content_fp` changes) but does not appear in
`composeEmbeddingText` (which omits tags), so `embed_fp` is unchanged → FTS refreshes,
vector is skipped. This is the spec's headline behavior and the field-set divergence
between `buildFtsRow` and `composeEmbeddingText` is what makes the two fingerprints
genuinely independent.

### 2.3 `model_id`

`"<embedder.id>#<embedder.dimension>"` from the `Embedder` interface
(`src/index/embedder.ts`, fields `id` and `dimension`). Re-embed fires when the current
identity differs from `index_state.model_id` (NULL or mismatch = changed; FR-004).

---

## 3. Skip-decision truth table (reference)

| `content_fp` match | FTS row present | → FTS action |
|---|---|---|
| yes | yes | skip |
| yes | no | recompute (FR-001 presence guard) |
| no / NULL | any | recompute |

| `embed_fp` match | `model_id` match | embedding row present | → vector action |
|---|---|---|---|
| yes | yes | yes | skip (`skippedUnchanged`) |
| yes | no | any | re-embed (`reembeddedDueToModelChange`) |
| yes | yes | no | re-embed (presence guard) |
| no / NULL | any | any | re-embed (content changed / new) |

`--full` ignores this table entirely and rebuilds all three stores (R7).

---

## 4. Proposed migration

**File**: `migrations/005_index_state.sql`

**Creates**:

```sql
-- 005_index_state.sql — per-dataset incremental-index fingerprint ledger.
-- Per data-model.md (003-incremental-indexing) §1.1. Separate from embeddings_meta
-- (global) and from index_failures (002, transient).
CREATE TABLE index_state (
  dataset_id TEXT PRIMARY KEY REFERENCES datasets(id),
  content_fp TEXT,
  embed_fp   TEXT,
  model_id   TEXT,
  updated_at TEXT NOT NULL
);
```

No secondary indexes (the PK serves point lookups; reconciliation is a full scan).

### 4.1 Migration numbering — CROSS-FEATURE COORDINATION REQUIRED

Existing applied migrations: `001_core.sql`, `002_curate_enrich.sql`,
`003_index.sql`. The next free numeric prefix is **004**. The migrate runner
(`src/store/migrate.ts`) sorts by numeric prefix, applies forward-only, and rejects a
checksum change on an already-applied version — so two branches that both claim `004`
will collide on merge (duplicate `version = 4`).

**Three in-flight features each add one migration and MUST coordinate the prefix:**

| Feature | Branch | New table | Proposed file |
|---|---|---|---|
| 002-batch-embedding | `002-batch-embedding` | `index_failures(dataset_id, reason, updated_at)` | `00X_index_failures.sql` |
| 003-incremental-indexing (this) | `003-incremental-indexing` | `index_state(dataset_id, content_fp, embed_fp, model_id, updated_at)` | `00X_index_state.sql` |
| 004-crawl-checkpoint-resume | `004-crawl-checkpoint-resume` | (its own table[s]) | `00X_crawl_checkpoint.sql` |

**Resolution rule**: assign 004/005/006 in *merge order* — the first feature to merge
takes 004, the next rebases to 005, the next to 006. Do **not** infer the migration
number from the feature/branch number: branch `003-*` does **not** imply migration
`003_*` (that prefix is already `003_index.sql`). This plan writes `005_index_state.sql`
as the proposed name but the merging engineer MUST renumber to the next actually-free
prefix at merge time.

---

## 5. Validation rules

Consistent with data-model 001 §5 (Zod at every boundary, Principle VII):

1. **Persisted-record load** (`src/index/`): `index_state` rows are read as point
   lookups with all-nullable fingerprint columns; reads tolerate NULLs by design
   (NULL ⇒ recompute). A typed row interface (`IndexStateRow`) mirrors the columns; no
   JSON columns, so no Zod parse of nested JSON is needed here.
2. **Config**: `config.index.incremental` is already validated by `IndexConfigSchema`
   (`src/config/schema.ts`) as a required boolean — no schema change in this feature.
   The default-true and `--full` override are applied in `runIndex`, not in the schema.
3. **No new read-consumer contract**: `index_state` is internal index bookkeeping, not
   a published read contract; it is not added to `specs/.../contracts/`. The run-result
   counts (R9) flow through the existing CLI `JSON.stringify(result)` surface.

---

## 6. Relationship to existing tables

```
datasets (1) ──< index_state              (PK dataset_id; FK → datasets.id; no cascade)
datasets_fts        keyed by dataset_id    (content_fp fingerprints its row)
dataset_embeddings  keyed by dataset_id    (embed_fp + model_id fingerprint its row)
embeddings_meta     single-row, global     (current embedder identity, recorded at run start)
index_failures      (002) keyed by dataset_id, transient — SEPARATE from index_state
```

`index_state` is the only table that joins "what fingerprint produced this row" to the
three index stores; it is the authority the skip gate (R3) and orphan purge (R6) consult.
