# Phase 0 Research — 003-incremental-indexing

**Date**: 2026-06-03
**Status**: Resolves all unknowns in plan.md so Phase 1 can proceed.

The spec is fully clarified (two clarification rounds, 2026-06-03). The remaining
work is *engineering* unknowns: exactly how to fingerprint, where to store state,
how to gate skip vs. recompute, how to purge, and how this composes with the
existing `runIndex` orchestrator (`src/index/run-index.ts`) and with feature 002.
Each decision is in the canonical **Decision / Rationale / Alternatives considered**
form and is grounded in the code actually read.

---

## R1 — Fingerprint serialization (content_fp vs embed_fp)

**Decision**:
- `content_fp` = `sha256Hex` (`src/lib/hash.ts`) over the FTS field set rendered as
  ordered `label=value\n` lines, one line per `FtsRow` field **in the column order
  declared by `migrations/003_index.sql`**: `title_bg`, `title_en`, `description_bg`,
  `description_en`, `publisher_label`, `tag_labels`, `group_labels`, `column_labels`,
  `entity_labels`. The `dataset_id` column (UNINDEXED) is excluded. Empty fields are
  emitted as `label=\n` (empty value, line still present) so a value moving across a
  field boundary changes the digest.
- `embed_fp` = `sha256Hex` over the **exact** string returned by
  `composeEmbeddingText(db, datasetId)` (`src/index/vec.ts`) — no re-ordering, no
  trimming, no re-join. Whatever that function emits is the fingerprinted bytes.

**Rationale**: The spec's round-2 clarification is explicit: "`content_fp` = SHA-256
over all FTS fields rendered as ordered `label=value\n` lines (empty fields included
as empty values); `embed_fp` = SHA-256 over the exact `composeEmbeddingText` output."
The two inputs already diverge in the code: `buildFtsRow` includes
`publisher_label`, `tag_labels`, `group_labels`, `column_labels` (`src/index/fts.ts`),
whereas `composeEmbeddingText` includes only `title_bg`, `titleEn`, `description_bg`,
`descEn`, `entityLabels` and drops empty segments via `.filter((s) => s.length > 0)`
(`src/index/vec.ts`). Fingerprinting each separately is therefore *required* to honor
the spec's headline behavior: a tags-only change must bump `content_fp` (tags are in
the FTS row) but **not** `embed_fp` (tags are absent from the embedding text), so the
keyword entry refreshes without a re-embed (FR-003, edge case "tags-only change").

Deriving the content fingerprint from the **typed `FtsRow`** (not from raw SQL) means
the fingerprint is computed from the same object that is upserted, eliminating any
drift between "what we hashed" and "what we wrote". A dedicated serializer
`serializeFtsRow(row): string` lives next to `buildFtsRow`.

**Alternatives considered**:
- *Hash a JSON-stringified FtsRow*: rejected — key ordering is not guaranteed stable
  across engines/refactors, and the spec pins the exact `label=value\n` line format
  for field-boundary detection.
- *Single combined fingerprint for both stores*: rejected — collapses FTS and vector
  skip decisions, defeating the tags-only-refresh requirement (FR-003).
- *Hash the curated artifact bytes on disk*: rejected — the indexable text is a
  composition over `datasets`, `translations`, `entities`, `organizations`, and
  `curated_artifacts.schema_json` (see `buildFtsRow`), not any single file; the
  composed text is the only correct fingerprint surface.

---

## R2 — Where index state lives: new `index_state` table

**Decision**: A new table `index_state(dataset_id PK, content_fp, embed_fp, model_id,
updated_at)` created by a new forward-only migration. It is **separate** from the
`embeddings_meta` single-row table (`src/index/embeddings-store.ts`) and **separate**
from feature 002's `index_failures` table.

**Rationale**: The spec mandates per-dataset state with independently-skippable FTS and
vector fingerprints plus a per-dataset model identity (FR-003, FR-004). `embeddings_meta`
is a single global row recording the *current* embedder (`model_id`, `dimension`,
`updated_at`) and cannot answer "what model produced *this dataset's* stored vector".
The round-2 clarification makes the per-dataset model comparison the source of truth:
"Re-embed is decided per dataset by comparing the current embedder id/dimension to that
row's `index_state.model_id`." Storing `model_id` per dataset is what makes a partial /
interrupted model switch converge correctly. `index_state.model_id` records the embedder
identity (and dimension) that produced the *currently stored* vector for that dataset.

Keeping `index_state` distinct from 002's `index_failures` follows the explicit
cross-feature note ("kept separate from 003's `index_state`"): failures are transient and
cleared on success; index_state is the durable skip ledger. They have different lifecycles
and must not be conflated.

**Alternatives considered**:
- *Add `content_fp`/`embed_fp`/`model_id` columns to `datasets`*: rejected — pollutes the
  authoritative portal-mirror table (Principle X immutability spirit; data-model §1.1
  invariants) with derived index bookkeeping, and couples index state to dataset row
  lifecycle.
- *Reuse `embeddings_meta`*: rejected — it is single-row and global; cannot key per
  dataset.
- *Store fingerprints inside the FTS/vec tables*: rejected — `datasets_fts` is an FTS5
  virtual table (no arbitrary side columns without re-tokenization cost) and the embeddings
  table is a `vec0`/BLOB store; neither is a natural home for a skip ledger.

**Encoding of model_id**: a composite string `"<embedder.id>#<dimension>"` (e.g.
`local-onnx:paraphrase-multilingual-MiniLM-L12-v2#384`). The `Embedder` interface
(`src/index/embedder.ts`) exposes both `id` and `dimension`; the spec ties re-embed to a
change in **either** id **or** dimension (FR-004), so both are folded into the stored
identity. A single string keeps the comparison a trivial equality and survives a future
embedder that changes dimension without changing id.

---

## R3 — Skip gate: fingerprint AND model AND store-row-present

**Decision**: Per dataset, compute:
- `ftsSkip` = `state?.content_fp === currentContentFp` **AND** the `datasets_fts` row for
  that dataset exists.
- `vecSkip` = `state?.embed_fp === currentEmbedFp` **AND** `state.model_id ===
  currentModelId` **AND** the `dataset_embeddings` row for that dataset exists.

Recompute the corresponding store whenever its skip is false. A `null`/absent
`index_state` row, an unrecognized/legacy fingerprint, or a missing store row all yield
skip = false (recompute).

**Rationale**: FR-001 and the round-2 clarification are explicit — "Skip only when the
fingerprint matches AND the corresponding store row is present; otherwise recompute." This
is what makes an interrupted run self-heal (edge case: partial previous run): if a
fingerprint was somehow written but the store row is missing, the presence check forces a
rebuild. The FTS and vector gates are evaluated independently so a tags-only change
recomputes only FTS. The model-identity term lives only in `vecSkip`, never `ftsSkip`,
because "a model change MUST re-embed vectors only; the model-independent FTS index MUST
NOT be rebuilt by a model change" (FR-004).

The store-presence checks are cheap point lookups: `SELECT 1 FROM datasets_fts WHERE
dataset_id = ?` and `SELECT 1 FROM dataset_embeddings WHERE dataset_id = ?` (the embeddings
table is a plain table today per `embeddings-store.ts`). Per-2-clarification, transactional
write ordering (R5) makes the "fp written without store row" case rare, but the presence
check is the belt-and-suspenders guarantee FR-001 demands and is verified by the
interrupted-run test.

**Alternatives considered**:
- *Trust the fingerprint alone*: rejected — directly violates FR-001 and would leave an
  interrupted run permanently missing a store row with no path back short of `--full`.
- *Fold model identity into `embed_fp`*: rejected — then a model change would be
  indistinguishable from a content change in counts (FR-007 requires a distinct
  `reembeddedDueToModelChange` count) and could not be reported separately.

---

## R4 — Default/precedence wiring (`--full` > config > default true)

**Decision**: `runIndex` gains an effective-mode resolution. The CLI
(`src/cli/index-cmd.ts`) already parses `--full` and `--datasets`. The command passes the
config-derived `incremental` flag into `runIndex`; `runIndex` computes `incremental =
!full && (config.index.incremental ?? true)`. `--full` is a one-shot override that does not
mutate config. Precedence: `--full` (force full) > `config.index.incremental` (may disable)
> default `true`.

**Rationale**: FR-009 fixes the precedence exactly. `config.index.incremental` already
exists as a **required** boolean in `IndexConfigSchema` (`src/config/schema.ts`); the spec
treats `false` as "disable incremental". The default-true semantics are honored by reading
the config value (already validated present) and only falling back to `true` if a future
schema makes it optional — keeping the change minimal. The CLI surface already exists; only
the plumbing of the config flag into `runIndex` and the new mode branch are added.

**Alternatives considered**:
- *Make `--full` mutate `config.index.incremental`*: rejected — `--full` is explicitly a
  "one-shot force-rebuild" (clarification round 1); persisting it would silently disable
  incremental for all later runs.
- *New `--incremental` CLI flag*: rejected — YAGNI (Principle V); the spec only asks for
  `--full` plus the config toggle.

---

## R5 — Per-dataset transactional write ordering

**Decision**: Each dataset's index work commits in **one** `db.transaction` (via
`withTransaction`, `src/store/db.ts`) that, in order: (a) upserts the FTS row then writes
`content_fp`; (b) persists the vector then writes `embed_fp` + `model_id`; (c) commits.
`content_fp` is never written before the FTS upsert; `embed_fp`/`model_id` are never written
before the vector is persisted. An `index_state` upsert merges only the fields whose work
ran this pass (a tags-only refresh updates `content_fp` and leaves `embed_fp`/`model_id`
intact).

**Rationale**: FR-010 and the round-2 clarification: "`content_fp` is written only after the
FTS upsert and `embed_fp` only after the vector is persisted, committed per-dataset in one
transaction; a dataset is never marked done without its matching store row." The existing
`upsertFtsRow` (delete-then-insert, `src/index/fts.ts`) and `upsertEmbedding`
(`INSERT OR REPLACE`, `src/index/embeddings-store.ts`) are both idempotent, so wrapping them
per-dataset in a transaction is safe and makes an interrupted run leave the DB at a
dataset boundary, never mid-dataset. Per-dataset (not whole-run) commit granularity is what
lets the *next* run converge cheaply: completed datasets stay skipped.

**Composition with 002 batching**: Round-2 of 002 states "FTS row upserts stay per-dataset
and are explicitly outside the batching path." So the FTS leg (`content_fp`) is always
per-dataset and immediate. The vector leg, when 002 lands, embeds the **changed set** in
batches; `embed_fp`/`model_id` for a dataset are written only after *that dataset's* vector
returns from the batch and is persisted. The `index_state` write therefore sits at the
seam: 003 decides *which* datasets need a vector (the changed set), 002 decides *how* they
are embedded (batched). 003 must not assume one-at-a-time embedding — it hands a set to the
vector layer and records `embed_fp` per dataset as each vector lands.

**Alternatives considered**:
- *One transaction for the whole run*: rejected — an interrupt would roll back all progress,
  defeating "converge without a full rebuild" (FR-008, edge case partial run) and making
  large runs all-or-nothing.
- *Write both fingerprints up front, then do the work*: rejected — directly violates the
  "only after the work succeeds" ordering (FR-010) and would mark datasets done that were
  never written.

---

## R6 — Orphan purge keyed to `listActive()`, full-corpus even under `--datasets`

**Decision**: Every incremental run, after the recompute pass, reconciles all three stores
against `DatasetsRepo.listActive()` (`src/store/repos/datasets.ts`) and deletes rows for any
`dataset_id` present in a store but **not** in the active set, from `datasets_fts`
(`deleteFtsRow`), `dataset_embeddings` (`deleteEmbedding`), and `index_state`. The purge is
**full-corpus**: it runs over the entire active set regardless of `--datasets`. A
`--datasets` subset limits only *which* datasets are recomputed, never which active rows are
purged.

**Rationale**: FR-006 and the round-2 clarification are explicit on both the source of truth
(`listActive()`) and the scope ("the purge MUST run full-corpus even under `--datasets`").
The current `runIndex` already deletes the FTS row for a non-active dataset *only when that
dataset is in `targets`* (the `ds.lifecycle_state !== 'active'` branch) — which silently
leaves orphans for any withdrawn dataset not named in `--datasets`, and never touches
`dataset_embeddings` at all (the documented "current full path leaves orphan embeddings
behind" bug, spec edge case + US-1 "Why this priority"). The fix computes
`activeIds = new Set(listActive().map(d => d.id))` once, enumerates the dataset_ids actually
present in each store (`SELECT dataset_id FROM datasets_fts`, `... FROM dataset_embeddings`,
`... FROM index_state`), and deletes the set difference. This delivers SC-004 (a withdrawn
dataset disappears from both keyword and semantic search without a full rebuild).

**Alternatives considered**:
- *Purge only datasets seen this run*: rejected — that is the current bug; a withdrawn
  dataset outside `--datasets` would never be purged.
- *Rely on FK `ON DELETE CASCADE`*: rejected — `datasets` rows are never deleted (data-model
  §1.1 invariant: withdrawn datasets keep their row), so there is no delete to cascade from;
  the orphan condition is "lifecycle != active", not "row gone".

---

## R7 — `--full` rebuild semantics (single transaction, not bare FTS DELETE)

**Decision**: `--full` rebuilds all three stores in **one** transaction: clear
`datasets_fts`, `dataset_embeddings`, and `index_state`, then re-derive every active
dataset's FTS row, vector, and fresh `index_state`. The global embedder identity is recorded
once at run start via `embeddings_meta` (R8). The orphan reconciliation is implied (a full
rebuild over `listActive()` cannot produce orphans).

**Rationale**: FR-005 and the round-2 clarification: "`--full` rebuilds all stores in one
transaction (not a bare FTS `DELETE`)." The current `--full` does only
`opts.db.exec('DELETE FROM datasets_fts')` (`src/index/run-index.ts`) — it leaves
`dataset_embeddings` and (the new) `index_state` untouched, so vectors from a prior model
survive a "force rebuild" (US-3 / SC-005 violation). The new behavior wraps the three
clears + the full recompute in `withTransaction` so a crashed `--full` is atomic: either the
old index stands or the new one does, never a half-cleared mix.

**Alternatives considered**:
- *Drop and recreate the FTS5 virtual table*: rejected — unnecessary DDL; `DELETE FROM
  datasets_fts` empties the index, and recreating the vec/embeddings table risks dimension
  drift. A transactional `DELETE` of all three is sufficient and cheaper.

---

## R8 — Model-change detection & `embeddings_meta` NULL bootstrap

**Decision**: At run start, read `embeddings_meta` (`getEmbeddingsMeta`,
`src/index/embeddings-store.ts`) and compute the current model identity
`"<embedder.id>#<embedder.dimension>"`. If `embeddings_meta.model_id`/`dimension` differ
from the current embedder (or are NULL), record the new identity once via `setEmbeddingsMeta`
**at run start**. Per dataset, `vecSkip` compares the current identity to
`index_state.model_id`; NULL or mismatch ⇒ re-embed that dataset. Datasets re-embedded
because the identity changed (not the text) are counted as
`reembeddedDueToModelChange` (FR-007).

**Rationale**: Round-2 clarification: "Model identity when `embeddings_meta` is NULL? →
Re-embed is decided per dataset by comparing the current embedder id/dimension to that row's
`index_state.model_id` (NULL or mismatch = changed); the global `embeddings_meta` identity is
recorded once at run start, so the first run after a NULL meta behaves as model-changed."
The first run after a fresh DB has every `index_state.model_id` NULL/absent ⇒ all datasets
re-embed (correct: nothing is indexed yet). Recording the global identity at run start (not
per dataset inside `upsertEmbeddingFor`, as today) decouples the global marker from the
per-dataset decision, so a partial model switch still re-embeds the not-yet-converted
datasets on the next run because their `index_state.model_id` still holds the old identity.

**Note on existing coupling**: today `upsertEmbeddingFor` writes `embeddings_meta` lazily on
the first embed (`src/index/vec.ts`). That stays valid as a safety net, but the per-dataset
decision no longer depends on it — it depends on `index_state.model_id`, which is the durable
per-vector identity.

**Alternatives considered**:
- *Decide re-embed from `embeddings_meta` alone*: rejected — it is global; once flipped to
  model B at run start, it can no longer tell which datasets still hold model-A vectors,
  breaking convergence of a partial switch (SC-005).

---

## R9 — Run counts / reporting shape

**Decision**: Extend `RunIndexResult` (`src/index/run-index.ts`) with the FR-007 counts:
`embedded`, `skippedUnchanged`, `reembeddedDueToModelChange`, `purged`, alongside the
existing `ftsUpdated`/`vectorsUpdated`. The CLI already prints `JSON.stringify(result)`
(`src/cli/index-cmd.ts`), so the new counts surface automatically.

**Rationale**: FR-007 enumerates exactly these four counts; SC-001/SC-002/SC-003 are stated
in their terms (zero re-embedded on no-change; exactly K re-embedded; 100% on model switch).
Keeping `ftsUpdated`/`vectorsUpdated` preserves backward compatibility with existing index
tests. When 002 lands, its richer `embedded`/`embedderRequests`/`skippedEmpty`/`failed`
shape composes additively — 003 owns `skippedUnchanged`/`reembeddedDueToModelChange`/
`purged`, 002 owns the batching telemetry.

**Alternatives considered**:
- *A separate stats object returned out-of-band*: rejected — the CLI contract is "print the
  result JSON"; extending the result is the least-surprise change.

---

## R10 — Migration numbering coordination (cross-feature)

**Decision**: This feature proposes `migrations/005_index_state.sql`. **FLAG**: three
in-flight features each need a migration and must coordinate the numeric prefix to avoid a
collision, because `discoverMigrations` (`src/store/migrate.ts`) sorts by the numeric prefix
and `runMigrations` enforces forward-only application with a checksum guard.

- 002-batch-embedding → `index_failures(dataset_id, reason, updated_at)`
- 003-incremental-indexing (this) → `index_state(dataset_id, content_fp, embed_fp,
  model_id, updated_at)`
- 004-crawl-checkpoint-resume → (its own table[s])

Existing applied migrations are `001_core`, `002_curate_enrich`, `003_index`. The next free
number is **004**. Whichever feature merges first takes 004; the others rebase to 005, 006 in
merge order. The branch name (`003-incremental-indexing`) is **not** the migration number —
do not assume `003_*` is free (it is taken by `003_index.sql`).

**Rationale**: The migrate runner keys on the numeric prefix and rejects a changed checksum
for an already-applied version, so two un-coordinated `004_*.sql` files on different branches
would both apply locally but collide on merge (duplicate `version = 4`). The data-model
records the proposed name but flags the coordination requirement explicitly so the merging
engineer renumbers deterministically.

**Alternatives considered**:
- *Timestamp-prefixed migrations*: rejected — the whole codebase uses zero-padded sequential
  prefixes (`NNN_name.sql`) and the runner's `MIGRATION_RE` and sort assume it; changing the
  scheme is out of scope (Principle V).
- *One combined migration across features*: rejected — couples three independent features'
  merge order; each ships its own table per its own spec.
