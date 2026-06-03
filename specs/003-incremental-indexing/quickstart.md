# Quickstart — Incremental Indexing (003)

> **Audience**: an operator (or test author) verifying that a routine re-index
> only touches what changed, that switching embedders re-embeds everything, and
> that `--full` force-rebuilds. Assumes a store already populated by `danni sync`
> + `danni curate` (see 001 quickstart) and the new `005_index_state.sql`
> migration applied.

All commands run from the repo root with Bun installed.

## 0. Apply migrations

The new `index_state` table ships as a migration. Apply pending migrations:

```bash
bun run src/store/migrate-cli.ts
# expect: applies 005_index_state (or its coordinated number) if not yet applied
```

Confirm the table exists:

```bash
bun run -e "import {openDb} from './src/store/db.ts'; const db=openDb({storeRoot:'store',loadVec:false}); console.log(db.query(\"SELECT name FROM sqlite_master WHERE type='table' AND name='index_state'\").all()); db.close();"
# expect: [ { name: "index_state" } ]
```

## 1. Build the full index once (baseline)

```bash
bun run src/cli/index.ts --full
# expect JSON like:
# {"ftsUpdated":N,"vectorsUpdated":N,"embedded":N,"skippedUnchanged":0,"reembeddedDueToModelChange":0,"purged":0}
```

`N` = number of active datasets. `--full` rebuilds all three stores
(`datasets_fts`, `dataset_embeddings`, `index_state`) in one transaction (FR-005).

## 2. Re-index with NO changes — zero re-embeds (SC-001, US-1)

Run the indexer again immediately, incrementally (the default):

```bash
bun run src/cli/index.ts
# expect:
# {"ftsUpdated":0,"vectorsUpdated":0,"embedded":0,"skippedUnchanged":N,"reembeddedDueToModelChange":0,"purged":0}
```

**Acceptance check (SC-001 / US-1 scenario 1)**: `embedded` and
`vectorsUpdated` are `0`; `skippedUnchanged` equals `N`. Verify stored vectors are
byte-unchanged:

```bash
# capture a vector hash before and after a no-op run; they must match
bun run -e "import {openDb} from './src/store/db.ts'; import {createHash} from 'node:crypto'; const db=openDb({storeRoot:'store',loadVec:false}); const rows=db.query('SELECT dataset_id, vector FROM dataset_embeddings ORDER BY dataset_id').all(); const h=createHash('sha256'); for(const r of rows){h.update(r.dataset_id); h.update(r.vector);} console.log(h.digest('hex')); db.close();"
# run this before and after step 2 — the two digests MUST be identical
```

## 3. Change ONE dataset — exactly one re-embed (SC-002, US-1)

Touch one dataset's indexable content (e.g. via a re-sync, or directly for the
test). Then:

```bash
bun run src/cli/index.ts
# expect (for a content change touching the embedding input):
# {"ftsUpdated":1,"vectorsUpdated":1,"embedded":1,"skippedUnchanged":N-1,"reembeddedDueToModelChange":0,"purged":0}
```

**Acceptance check (SC-002 / US-1 scenario 2)**: exactly the changed dataset is
re-embedded; all others are skipped.

### 3a. Tags-only change — FTS refreshes, vector is NOT re-embedded

Change only a dataset's `tags_json` (tags are in the FTS row but not in
`composeEmbeddingText`):

```bash
bun run src/cli/index.ts
# expect:
# {"ftsUpdated":1,"vectorsUpdated":0,"embedded":0,"skippedUnchanged":N,"reembeddedDueToModelChange":0,"purged":0}
```

**Acceptance check (FR-003)**: `ftsUpdated == 1` while `vectorsUpdated == 0` —
`content_fp` bumped, `embed_fp` unchanged.

## 4. Switch the embedder — re-embed the whole corpus (SC-003, US-2)

Edit `danni.config.json` so `enrichment.embedder.modelId` (or provider/dimension)
differs from the prior run, then:

```bash
bun run src/cli/index.ts
# expect:
# {"ftsUpdated":0,"vectorsUpdated":N,"embedded":0,"skippedUnchanged":0,"reembeddedDueToModelChange":N,"purged":0}
```

**Acceptance check (SC-003 / US-2)**: `reembeddedDueToModelChange == N` (every
active dataset), `ftsUpdated == 0` (a model change does NOT rebuild FTS, FR-004).
Confirm the recorded global identity flipped:

```bash
bun run -e "import {openDb} from './src/store/db.ts'; const db=openDb({storeRoot:'store',loadVec:false}); console.log(db.query('SELECT model_id, dimension FROM embeddings_meta WHERE id=1').get()); console.log(db.query('SELECT DISTINCT model_id FROM index_state').all()); db.close();"
# expect: embeddings_meta + every index_state.model_id reflect the NEW embedder
```

Re-running with the same embedder must report `0` re-embeds (US-2 scenario 2):

```bash
bun run src/cli/index.ts
# expect: skippedUnchanged == N, reembeddedDueToModelChange == 0
```

## 5. Withdraw a dataset — purged from all stores (SC-004)

Withdraw a dataset upstream (or set `lifecycle_state='withdrawn'` for the test),
then run incrementally:

```bash
bun run src/cli/index.ts
# expect: "purged":1 (the withdrawn dataset)
```

**Acceptance check (SC-004)**: the withdrawn dataset is absent from
`datasets_fts`, `dataset_embeddings`, AND `index_state`:

```bash
bun run -e "import {openDb} from './src/store/db.ts'; const db=openDb({storeRoot:'store',loadVec:false}); const id=process.env.ID; for(const t of ['datasets_fts','dataset_embeddings','index_state']){console.log(t, db.query(\`SELECT COUNT(*) c FROM \${t} WHERE dataset_id=?\`).get(id));} db.close();" 
# with ID=<withdrawn-dataset-id> set — expect c:0 for all three tables
```

### 5a. Purge runs full-corpus even under `--datasets`

Withdraw a dataset, then run a subset re-index that does NOT name it:

```bash
bun run src/cli/index.ts --datasets some-other-id
# expect: the withdrawn dataset is STILL purged (purge is full-corpus),
#         while only `some-other-id` is considered for recompute (FR-006).
```

## 6. Disable incremental via config

Set `index.incremental = false` in `danni.config.json` and run without `--full`:

```bash
bun run src/cli/index.ts
# expect: every active dataset recomputed (no skipping), but NOT a destructive
#         full-store clear (that is --full only). Precedence: --full > config > default true.
```

Re-enable by setting `index.incremental = true` (or removing the override; default
is `true`).

## 7. Interrupted-run convergence (FR-008, edge case)

Simulate an interrupted run (kill mid-index), then re-run incrementally:

```bash
bun run src/cli/index.ts
# expect: the run converges — any dataset whose fingerprint was recorded WITHOUT
#         its store row is recomputed (presence guard, FR-001); no --full needed.
```

**Acceptance check (SC-005)**: after any sequence of incremental runs, the index
matches a single `--full` on the same final state. Verify by capturing the FTS +
vector content hash after incremental convergence, running `--full`, and comparing:

```bash
# 1) hash after incremental runs (FTS rows + vectors), 2) run --full, 3) re-hash, 4) compare
bun run src/cli/index.ts --full
# the FTS-row set and the per-dataset vector set MUST be identical to the pre-full state
```

## Success-criteria checklist (from spec §Success Criteria)

- **SC-001**: step 2 — no-change re-index re-embeds 0, completes far faster than `--full`.
- **SC-002**: step 3 — exactly K of N changed ⇒ exactly K re-embedded.
- **SC-003**: step 4 — switching embedders ⇒ 100% of active datasets re-embedded.
- **SC-004**: step 5 — withdrawn dataset absent from keyword AND semantic search, no `--full`.
- **SC-005**: step 7 — any incremental sequence == one `--full` on the same final state.
