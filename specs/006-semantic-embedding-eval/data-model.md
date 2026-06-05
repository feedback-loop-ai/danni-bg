# Data Model — 006-semantic-embedding-eval

**Date**: 2026-06-05
**Status**: Implemented
**Scope**: **No database schema change and no new migration.** This feature made the
vector leg of hybrid search real (a configurable multilingual embedder behind a shared
factory) and added the instrument to measure retrieval quality (recall@K). It added one
optional **config** field (`enrichment.embedder.dimension`), one new *internal* report
shape (`RecallReport` in `src/index/eval.ts`), one shared selection module
(`src/index/embedders/factory.ts`), and a new CLI (`danni eval`). It tightened one
existing class (`HostedApiEmbedder` now validates the returned vector length). Search
results reuse the existing closed read contract (`IndexEntry` / `index-entry.schema.json`,
owned by 001) unchanged — the eval report is an internal shape, never published. There is
therefore **no `contracts/` directory** for this feature, exactly as for 002, 003, and 005
(R6).

> **Naming convention** (inherited from 001): `snake_case` SQL identifiers;
> `kebab-case` file paths; `camelCase` TypeScript fields. Timestamps are ISO-8601
> UTC `TEXT` via `nowIso()` (`src/lib/time.ts`).

---

## 1. No schema change / no migration

The last applied migration remains `005_index_state.sql` (from feature 003). This feature
added **no** `migrations/*.sql` file. The two tables the model-change re-embed reads and
writes — `embeddings_meta(model_id, dimension, updated_at)` and the per-dataset
`index_state` — already existed (`embeddings_meta` since `002_curate_enrich.sql`,
`index_state` since `005_index_state.sql` of feature 003). Confirmation that nothing in the
data layer changed:

- No new table, column, or index. `embeddings_meta` already carried the `dimension` column
  this feature now drives; the embedding stores, `index_state`, and the entities/curated
  tables are all read/written as-is.
- The newly real vector leg writes the same vector blobs through the same store the stub
  used; only the *bytes* (now semantically meaningful) differ, not the shape.
- The published index-entry contract file (`specs/001-egov-data-sync/contracts/index-entry.schema.json`,
  owned by 001) is byte-for-byte unchanged. `search()` already emitted the
  `matchKind: 'keyword' | 'semantic' | 'hybrid' | 'entity'` discriminator; making the
  vector leg real only changes which value a given hit earns, not the schema.

---

## 2. Added config field — `enrichment.embedder.dimension` (FR-001)

`EmbedderConfigSchema` (`src/config/schema.ts`) gained one optional field. The schema stays
`.strict()`; this is purely additive.

| Aspect | Settled behavior |
|---|---|
| Field | `dimension` |
| Type | `z.number().int().min(1).max(8192).nullable().optional()` |
| Meaning | The model's embedding vector length, recorded in `embeddings_meta`. Set it to match the configured model (e.g. 384 for `paraphrase-multilingual-MiniLM-L12-v2`, 4096 for `Qwen3-Embedding-8B`). |
| Default when unset | The provider default: `local-onnx` → 32 (the hash stub); `hosted-api` → 384. (Both defaults live in the embedder ctors, not the schema.) |
| Effect on persistence | A change vs the stored `embeddings_meta.dimension` drives a **full vector re-embed** via run-index's model-change path (§4). |
| Why config, not auto-detect (R2) | So the model-change re-embed is deterministic, and so `HostedApiEmbedder` can validate the API's actual output against the declared contract (§3). |

No other config field changed. `provider`, `modelId`, `endpointUrl`, `apiKeyEnv`,
`batchSize`, and `maxBatchSize` are all pre-existing.

---

## 3. Shared selection module — `buildEmbedder` factory (FR-002)

`src/index/embedders/factory.ts` is a **new internal module** (not a published contract,
not added to any `contracts/` directory). It is the single authority for provider selection
so `danni index`, `danni search`, and `danni eval` cannot drift on which embedder they use
(R1).

```ts
function buildEmbedder(e: DanniConfig['enrichment']['embedder']): Embedder
```

| `enrichment.embedder.provider` | Constructs | Notes |
|---|---|---|
| `'hosted-api'` | `HostedApiEmbedder` | Requires `endpointUrl` (throws otherwise). Reads the bearer token from `process.env[apiKeyEnv]` when `apiKeyEnv` is set. Threads `modelId`, `dimension`, and `maxBatchSize`. The production backend is a *local* OpenAI-compatible server (e.g. vLLM serving Qwen3-Embedding-8B) reusing this same provider — no new dependency, no data egress (R1). |
| `'local-onnx'` | `LocalOnnxEmbedder` | Threads `modelId` + `dimension`. When the resulting embedder `isStub` is `true`, the factory writes one **stderr** warning naming the stub id (`local-onnx:hash-stub-32`) so its non-semantic vectors are not mistaken for a real model (FR-006, R3). |

The factory threads `dimension` + `maxBatchSize` into both providers, so the declared
dimension reaches `embeddings_meta` (index), the recall harness (eval), and the runtime
cosine path (search) identically. The stub warning fires at this CLI-boundary factory, not
in the `LocalOnnxEmbedder` constructor — the ctor is used legitimately by many tests with
the stub, so warning there would spam/mislead (R3); `isStub` exposes the state and the
factory decides.

---

## 4. Model-change re-embed — how `dimension` triggers it (FR-001, SC-001)

The re-embed machinery already existed (feature 002, run-index's model-change path). This
feature makes a `dimension` change a trigger for it, alongside the existing `model_id`
trigger. In `runIndex` (`src/index/run-index.ts`):

```ts
const meta = getEmbeddingsMeta(db);
if (meta.model_id !== opts.embedder.id || meta.dimension !== opts.embedder.dimension) {
  setEmbeddingsMeta(db, opts.embedder.id, opts.embedder.dimension);
}
```

- `getEmbeddingsMeta` / `setEmbeddingsMeta` read and write the single
  `embeddings_meta(id=1)` row (`src/index/embeddings-store.ts`).
- The per-dataset re-embed decision tags each pair as `content-changed` vs `model-changed`
  and increments `reembeddedDueToModelChange` for the latter; the global `embeddings_meta`
  marker is kept current for read consumers (R8 of an earlier spec).
- **Verified live (SC-001)**: switching `provider` stub→real and running `danni index`
  re-embedded every active dataset via the model-change path — 100 datasets in 4 batches,
  ~2s.

So an operator points `enrichment.embedder` at a real model by editing config, and a single
re-index swaps the stub for the real model with no code change (US1).

---

## 5. Returned-vector validation — `HostedApiEmbedder` (FR-003, US4)

`HostedApiEmbedder` (`src/index/embedders/hosted-api.ts`) POSTs the OpenAI-compatible
`{ input, model }` to the configured `/embeddings` endpoint and reads
`{ data: [{ embedding }] }`. Two guards make a misconfiguration loud rather than silently
degrading:

| Guard | Behavior |
|---|---|
| Count check | `data.length !== texts.length` → throws (`returned N vectors, expected M`). |
| Dimension check (new, FR-003) | The first returned vector's length must equal the configured `dimension`; on mismatch it throws (`returned G-dim vectors but enrichment.embedder.dimension is D; set dimension to G to match the model`). |

The dimension check exists because `cosine()` returns `0` for vectors of differing length:
a wrong `dimension` would turn semantic ranking off with no error and degrade search to
keyword-only. The declared dimension is the contract (R2).

---

## 6. New internal report shape — `RecallReport` (FR-004)

`src/index/eval.ts` exposes the backend-agnostic recall harness and its report shape. These
are **internal** types (not a published contract). `evaluateRecall` runs each labelled query
through the real hybrid `search()` and scores recall@K, so it measures whatever embedder is
wired and doubles as the validation instrument for the embedder swap (R4).

```ts
async function evaluateRecall(opts: EvaluateRecallOptions): Promise<RecallReport>
```

### 6.1 Input — `RecallQuery`

| Field | Type | Meaning |
|---|---|---|
| `query` | `string` | The query text. |
| `lang` | `'bg' \| 'en'` | The query language (the cross-lingual split axis). |
| `expected` | `string[]` | Dataset id(s) a correct search should surface; the query *hits* if **any** id appears in the top-K. |
| `rationale` | `string \| undefined` | Optional human note (why this id is the answer). |

### 6.2 Output — `RecallReport`

| Field | Type | Meaning |
|---|---|---|
| `limit` | `number` | The top-K cutoff used (default 5 — the SC-004 "top 5"). |
| `total` | `number` | Number of queries scored. |
| `hits` | `number` | Queries whose `expected` overlapped the top-K. |
| `recallAtK` | `number` | `hits / total` — **the SC-004 metric** (target ≥0.90). |
| `byLang` | `{ bg: LangRecall; en: LangRecall }` | Per-language `{ total, hits, recall }` (cross-lingual axis, FR-014 of spec 001). |
| `misses` | `QueryMiss[]` | Each failed query as `{ query, lang, expected, got }` so failures are diagnosable (expected vs retrieved). |

`recall` per language is `hits / total` (0 when the language has no queries). `recallAtK`
is `hits / total` over the whole set (0 when empty).

---

## 7. New CLI — `danni eval` (FR-005)

`src/cli/eval.ts`, registered in `src/cli/danni.ts`. It loads the query set, builds the
embedder via the shared factory (§3), runs `evaluateRecall`, prints (or emits JSON), and
gates on a recall floor.

| Flag | Validation | Meaning |
|---|---|---|
| `--query-set <path>` | required; zod-validated JSON (§7.1) | The labelled query set. |
| `--limit N` | `1..50`, default 5 | Top-K cutoff for a hit (SC-004 top-5 default). |
| `--min-recall R` | `0..1` | Exit **3** if `recallAtK < R` — used as `0.9` to gate on SC-004. |
| `--json` | flag | Emit the full `RecallReport` as JSON instead of the summary. |

**Exit codes**: `0` ok · `2` bad flag or unreadable/invalid query set · `3` below the
`--min-recall` floor. The query-set JSON is validated by `QuerySetSchema`
(`{ queries: [{ query, lang: 'bg'|'en', expected: [string≥1], rationale? }] }`, `queries`
non-empty); a zod failure is reported and exits 2.

### 7.1 Query-set fixtures

| File | Role |
|---|---|
| `tests/fixtures/search/query-set.json` | The small committed query set the CI smoke runs, written against the `CROSS_LANG_CORPUS` fixture so the two never drift. |
| `tests/fixtures/search/cross-lang-corpus.ts` | `CROSS_LANG_CORPUS: CrossLangDoc[]` — a shared bilingual corpus (BG originals + EN translations) seeded by both the cross-lingual search test and the eval CI smoke. |
| `tests/fixtures/search/live-query-set.example.json` | A real-id template captured from the live mirror (real data.egov.bg dataset ids, BG queries + EN→BG cross-lingual queries) — an operator template, not run by CI. |

---

## 8. Reused read contract — `IndexEntry` / `matchKind` (FR-004, SC-004)

The recall harness reads `search()` results, which already conform to `IndexEntry`
(`src/index/query.ts`, schema `index-entry.schema.json`, owned by 001). Nothing was added.
The existing `matchKind` discriminator is what makes the cross-lingual claim checkable:

- `keyword` — FTS rank only (no vector rank).
- `semantic` — vector rank only (no FTS rank).
- `hybrid` — both legs ranked.
- `entity` — entity-keyed retrieval.

**Verified (SC-004)**: an English query has zero FTS overlap with a Cyrillic title, so any
such hit is pure vector — confirmed `matchKind === 'semantic'`. Against vLLM
Qwen3-Embedding-8B (4096-dim) on the real mirror, recall@5 = 100% (38/38), including 8/8
English→Bulgarian. The CI smoke (`tests/integration/eval-smoke.test.ts`) runs the stub over
the committed fixture and holds `recallAtK ≥ 0.75` (CI floor) with both languages hitting;
the operational 0.90 number is recorded in `docs/semantic-search.md` (R5).

---

## 9. `LocalOnnxEmbedder.isStub`

A read-only boolean on the existing stub embedder (`src/index/embedders/local-onnx.ts`),
inherited from feature 005:

| Field | Type | Meaning |
|---|---|---|
| `isStub` | `boolean` | `true` when the ctor received no injected `embedFn` (it fell back to the deterministic `hashEmbedding` hash stub). Set as `this.isStub = opts.embedFn === undefined`. |

This feature is the consumer that reads `isStub` at the shared factory boundary (§3) to emit
the stderr stub warning (FR-006, R3). An injected real `embedFn` or the `hosted-api`
provider leaves `isStub` false, so the warning stays quiet for tests/real models.

---

## 10. Validation rules

Consistent with data-model 001 §5 (Zod/contract at every boundary):

1. **Config validated by zod**: `dimension` is a `z.number().int().min(1).max(8192)` on the
   still-`.strict()` `EmbedderConfigSchema`; the query set is validated by `QuerySetSchema`
   at the CLI boundary (bad input → exit 2).
2. **Provider output validated**: `HostedApiEmbedder.embed()` validates both the vector
   *count* and the vector *dimension* against the declared `dimension`, throwing on mismatch
   (§5) so search cannot silently degrade to keyword-only.
3. **Published contract unchanged**: `index-entry.schema.json` (owned by 001) is untouched;
   `search()` results already conform. The recall report is internal and never published.
4. **No new published contract for the internals**: `buildEmbedder` (factory), `RecallReport`
   / `evaluateRecall` (eval), and the `danni eval` CLI are internal module/CLI surfaces, not
   published read contracts, so they are not added to `specs/.../contracts/` — matching 002,
   003, and 005.

---

## 11. Relationship to existing tables and contracts

```
embeddings_meta (id=1)   model_id + dimension   (embedder.id/.dimension change → run-index model-change re-embed; SC-001)
index_state              keyed by dataset id     (per-dataset content-changed vs model-changed re-embed decision)
config.enrichment.embedder.dimension             (recorded in embeddings_meta; validated by HostedApiEmbedder against API output)
config.enrichment.embedder.provider              (selects HostedApiEmbedder vs LocalOnnxEmbedder in buildEmbedder)
IndexEntry.matchKind                             (search() discriminator; 'semantic' proves the pure-vector cross-lingual path, SC-004)
LocalOnnxEmbedder.isStub                         (read at the buildEmbedder boundary to emit the stderr stub warning)
RecallReport (internal)                          (evaluateRecall over the real search(); recallAtK = SC-004 metric)
```

`buildEmbedder` is the single point where index, search, and eval agree on a provider;
`embeddings_meta` is the join point where a config `dimension`/`provider` change becomes a
full vector re-embed; `IndexEntry.matchKind` is where the semantic leg becomes observable.
None of these introduces persistent state beyond the pre-existing `embeddings_meta` row.
