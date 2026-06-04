# Quickstart — Batched Embedding (002-batch-embedding)

> **Audience**: an operator (or CI) verifying that the vector re-index embeds in
> batches instead of one request per dataset. Assumes a populated store from the
> 001 pipeline (`danni sync` → `danni curate`). Builds on
> `specs/001-egov-data-sync/quickstart.md`.

## 0. Prerequisites

- A `store/danni.sqlite` already synced + curated (datasets present, lifecycle
  `active`).
- The `index_failures` migration applied (see step 1).
- An embedder configured under `enrichment.embedder` in `danni.config.json`.

## 1. Apply the new migration

```bash
bun run db:migrate
```

Idempotent. Creates `index_failures(dataset_id, reason, updated_at)` (the new
`004_index_failures.sql`). Verify:

```bash
bun run sqlite3 store/danni.sqlite ".schema index_failures"
# CREATE TABLE index_failures (dataset_id TEXT PRIMARY KEY, reason TEXT NOT NULL, updated_at TEXT NOT NULL);
```

## 2. Configure the batch size

Edit `danni.config.json` → `enrichment.embedder`:

```json
{
  "enrichment": {
    "embedder": {
      "provider": "local-onnx",
      "batchSize": 64,
      "maxBatchSize": 128
    }
  }
}
```

- `batchSize` default **32**, allowed **1–256** (rejected at startup otherwise).
- `maxBatchSize` optional cap; effective size = `min(batchSize, maxBatchSize,
  providerCap)`. Omit `maxBatchSize` for no cap.

Validate config without indexing:

```bash
bun run danni status     # fails fast if batchSize is out of 1–256
```

## 3. Full batched re-index

```bash
bun run danni index --full
```

Expect on stdout a single JSON result with the new counts:

```json
{
  "ftsUpdated": 1000,
  "vectorsUpdated": 1000,
  "embedded": 1000,
  "embedderRequests": 16,
  "skippedEmpty": 0,
  "failed": 0,
  "failures": []
}
```

For **N = 1000** datasets and `batchSize = 64`, `embedderRequests` is
**`⌈1000/64⌉ = 16`** (SC-001), not 1000. On stderr you should see **per-batch
progress** lines (batches done/total + running counts) — FR-010.

## 4. Inspect persisted not-embedded reasons

Datasets with empty composed text (FR-007) or texts that failed even on
single-text retry (FR-004) are recorded in `index_failures`:

```bash
bun run sqlite3 store/danni.sqlite "SELECT dataset_id, reason, updated_at FROM index_failures ORDER BY dataset_id LIMIT 20;"
```

Re-running the index after fixing/translating a dataset clears its row
automatically once it embeds successfully (FR-008).

## 5. Subset re-index (composes with incremental 003)

```bash
bun run danni index --datasets <id1>,<id2>
```

Only the named datasets are (re-)embedded; they are still batched. FTS upserts
happen per dataset and are outside the batching path (FR-010).

---

## Acceptance checks (map to spec Success Criteria)

### SC-001 — `⌈N / batchSize⌉` requests on the happy path

Use a recording embedder (test double) that counts invocations and texts-per-call.

```bash
# Integration test: tests/integration/index-batched.test.ts
bun test tests/integration/index-batched.test.ts
```

Asserts: for N datasets and batch size B, `embedderRequests === ⌈N/B⌉`
(far fewer than N for B > 1), every dataset has exactly one stored vector, and
each invocation carried ≤ B texts.

### SC-002 — Output-equivalence (batch size MUST NOT change the vector)

Index the same datasets twice with the same deterministic embedder — once at
`batchSize: 1`, once at `batchSize: 64` — and assert the `dataset_embeddings`
BLOB is **byte-identical per dataset** (incl. Cyrillic-text datasets):

```bash
bun test tests/integration/index-batched.test.ts -t "byte-identical batch 1 vs 64"
```

### SC-003 — Full corpus, no dataset left un-embedded except empty-text

After `danni index --full` over the real corpus with a batch-capable embedder:

```bash
# every active dataset with non-empty composed text has a vector
bun run sqlite3 store/danni.sqlite "
  SELECT COUNT(*) AS missing
  FROM datasets d
  WHERE d.lifecycle_state='active'
    AND NOT EXISTS (SELECT 1 FROM dataset_embeddings e WHERE e.dataset_id=d.id)
    AND NOT EXISTS (SELECT 1 FROM index_failures f WHERE f.dataset_id=d.id AND f.reason LIKE 'empty_text%');
"
# Expect: missing = 0
```

The hosted-embedder path completes within per-request limits because batches run
sequentially with 429/5xx backoff (FR-009).

### SC-004 — Transient batch failure is salvaged

With a test embedder that fails (or short-returns) one batch but succeeds on
single-text retries, the run still completes and only the texts that *also* fail
their single-text retry are recorded:

```bash
bun test tests/integration/index-batched.test.ts -t "transient batch failure salvaged"
```

Asserts: the run completes; `embedderRequests` includes the extra single-text
retries; `failed` counts only the genuinely-failing texts; each failure has a
reason in both `failures[]` and `index_failures`.

### Edge cases covered by unit tests (`tests/unit/index/batch-embed.test.ts`)

- Final partial batch (N not divisible by batch size).
- Empty composed text excluded from the batch, counted in `skippedEmpty`
  (FR-007).
- Embedder returning a **reordered / short** batch → whole batch fails the
  length check → single-text retry (FR-003 → FR-004).
- `maxBatchSize === 1` provider → forced single-text mode, distinct from the
  transient retry (FR-005).
- 429/5xx then 200 → retried with (injected, 0-delay) backoff, counted once as
  embedded (FR-009).

## What's not in this quickstart

- **Incremental skipping** (only re-embed changed datasets) — that's
  003-incremental-indexing; 002 batches whatever set it is given.
- **Choosing/bundling a real embedding model** — out of scope (spec Assumptions);
  the bundled deterministic stub is used for CI and is exercised through the
  batched path.
