# Feature Specification: Real Multilingual Embedder + Recall Evaluation

**Feature Branch**: `006-semantic-embedding-eval`  
**Created**: 2026-06-05  
**Status**: Implemented (shipped in `b11398e` Track B embedder wiring + eval harness and `d75007f` eval CI smoke + live query-set example; verified by the test suite, 2026-06-05)  
**Input**: User description: "danni-bg's hybrid search fuses a real FTS5 keyword leg with a vector cosine leg, but the vector leg shipped as a deterministic hash STUB (`local-onnx:hash-stub-32`) whose vectors carry no meaning. Make the vector leg real (a configurable multilingual embedder, switchable by config with a single re-index) and add the instrument to MEASURE retrieval quality (recall@K, split by language) so the swap can be validated against SC-004 — locate the most relevant dataset in the top 5 for ≥90% of a representative BG/EN query set."

## Clarifications

### Session 2026-06-05

- Q: How is a real embedder selected — a new code path, or config? → A: Config only. `enrichment.embedder` already chose between two providers (`local-onnx` | `hosted-api`); the production backend is a LOCAL OpenAI-compatible server reached through the existing `hosted-api` provider (e.g. vLLM serving Qwen3-Embedding-8B), so no new dependency and no data egress. An operator points `enrichment.embedder` at the real model and a single `danni index` swaps the stub for the real model with no code change. (Bundling `onnxruntime-node` was rejected as a heavy native dep; hosted OpenAI was rejected as a default for external egress.)
- Q: Is the embedding dimension auto-detected from the model or declared in config? → A: Declared in config (`enrichment.embedder.dimension`). An explicit dimension keeps the model-change re-embed deterministic and gives `HostedApiEmbedder` a contract to validate the API's returned vector length against. It is recorded in `embeddings_meta`; a change vs the stored value drives a full vector re-embed via `run-index`'s model-change path.
- Q: Where should the hash-stub warning fire — in the embedder constructor or at the CLI? → A: At the CLI boundary, inside the shared `buildEmbedder` factory, not in the `LocalOnnxEmbedder` ctor. Tests construct the stub legitimately, so warning in the ctor would spam and mislead. `LocalOnnxEmbedder.isStub` exposes the state (`true` when no real `embedFn` is injected); the factory decides whether to warn.
- Q: Is the recall harness tied to a specific embedder? → A: No. `evaluateRecall` is backend-agnostic — it runs the labelled query set through the real hybrid `search()` with whatever embedder is wired, so the SAME instrument scores the stub in CI and the real model operationally. `recall@5` is the SC-004 metric; it is split by language {bg,en} for the cross-lingual axis (FR-014 of spec 001).
- Q: Does this feature change the database schema or add an external contract? → A: No. `dimension` is an additive config field; `embeddings_meta(model_id, dimension)` already exists, so there is no new migration. The eval report (`RecallReport`) is an internal shape, and search results already conform to `index-entry.schema.json`. There is therefore no `contracts/` directory (matching 002, 003, and 005). The `danni eval` CLI is recorded in the existing `cli.md` contract.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Real semantic vectors via config (Priority: P1)

An operator points `enrichment.embedder` at a real multilingual model — a hosted API or a local OpenAI-compatible server — by editing config, and a single `danni index` swaps the meaningless hash stub for the real model with no code change.

**Why this priority**: The vector leg of hybrid search shipped as a deterministic hash stub, so semantic ranking was never real — only the keyword leg carried weight. Making the embedder real, switchable by config alone, is the whole point of the track: it is what turns "hybrid search" from a half-truth into a working capability, without forcing a code change or a new native dependency.

**Independent Test**: Set `enrichment.embedder.provider='hosted-api'` with an `endpointUrl` and a `dimension` matching the model, run `danni index`, and verify every active dataset is re-embedded through the real model (the `run-index` model-change path fires because the stored `embeddings_meta` differs), with no source edits.

**Acceptance Scenarios**:

1. **Given** an `enrichment.embedder` config naming the `local-onnx` stub, **When** the operator changes `provider` to `hosted-api` (pointing at a real model) and runs `danni index`, **Then** the stored `embeddings_meta` mismatch triggers a full re-embed of every active dataset and search thereafter uses the real model's vectors.
2. **Given** the shared `buildEmbedder` factory, **When** `danni index`, `danni search`, and `danni eval` each build their embedder, **Then** all three route through that single factory so they never drift on provider selection.
3. **Given** a `hosted-api` config pointing at an OpenAI-compatible `/embeddings` endpoint, **When** the embedder runs, **Then** it POSTs `{input, model}` and reads `data[].embedding` from the response, working against a hosted API or a local server (vLLM / text-embeddings-inference / Ollama) with no new dependency or data egress.

---

### User Story 2 - Measure recall (Priority: P1)

An operator (or CI) runs a labelled query set and gets `recall@K` overall and split by language (BG/EN), with the per-query misses, to know whether SC-004 is met.

**Why this priority**: Swapping the stub for a real model is only meaningful if its retrieval quality can be measured. Without an instrument, "is semantic search good enough?" is a guess. `recall@5` against a representative bilingual query set is the SC-004 acceptance number, and splitting it by language exposes the cross-lingual axis that monolingual recall would hide.

**Independent Test**: Run `danni eval --query-set <path>` over a seeded store and verify the report carries `recallAtK`, a `byLang.{bg,en}` split with `{total,hits,recall}`, and a `misses[]` list of `{query,lang,expected,got}`; add `--min-recall 0.9` and verify exit code 3 when the floor is not met.

**Acceptance Scenarios**:

1. **Given** a zod-valid query set, **When** `danni eval --query-set <path>` runs, **Then** it prints `recall@K` overall plus the bg/en split (and, in `--json`, the full `RecallReport` including `misses`).
2. **Given** `--min-recall 0.9`, **When** the computed `recall@K` is below 0.9, **Then** the CLI exits 3 (gating on SC-004); when it meets the floor it exits 0.
3. **Given** a malformed flag or an unreadable / schema-invalid query set, **When** the CLI runs, **Then** it exits 2 with a diagnostic on stderr, never crashing or scoring a partial set.
4. **Given** the harness, **When** it scores each query, **Then** it runs the query through the real hybrid `search()` with whatever embedder is wired, so the same instrument measures the stub in CI and the real model operationally.

---

### User Story 3 - No silent stub (Priority: P2)

When search, index, or eval falls back to the `local-onnx` hash stub, a stderr warning fires naming the stub model id, so meaningless vectors are not mistaken for real semantic ones.

**Why this priority**: The `local-onnx` provider is a deterministic hash stub whose vectors are not semantic. Presenting them silently lets an operator believe semantic ranking is working when only the keyword leg is real. A loud one-line stderr warning is cheap and prevents that misread. It is P2 because results are still returned and the keyword leg is unaffected.

**Independent Test**: Build the embedder via the shared factory with the default `local-onnx` config (no injected `embedFn`) and verify exactly one stderr warning naming `local-onnx:hash-stub-32` is emitted; build with an injected real `embedFn` (or `provider='hosted-api'`) and verify no warning fires.

**Acceptance Scenarios**:

1. **Given** the default `local-onnx` config (`isStub` true), **When** any CLI builds the embedder through `buildEmbedder`, **Then** a stderr warning naming the stub model id is emitted once, stating that semantic ranking is not meaningful and only the FTS/keyword leg is real.
2. **Given** an embedder with an injected real `embedFn`, or `provider='hosted-api'`, **When** the same factory runs, **Then** no stub warning is emitted (so tests and real models stay quiet).

---

### User Story 4 - Loud misconfiguration (Priority: P2)

If the configured `dimension` does not match the model's actual vector length, indexing fails fast with a clear error rather than silently degrading search to keyword-only.

**Why this priority**: `cosine()` returns 0 for vectors of differing length, so a wrong `dimension` would turn semantic ranking off without any error — the worst kind of failure, because search keeps returning results that look fine but lost their vector leg. Validating the returned vector length against the declared `dimension` and throwing converts a silent degradation into a loud, actionable stop.

**Independent Test**: Configure `dimension` to a value that disagrees with the embedder endpoint's actual output, run an embed, and verify it throws an error naming both the returned dimension and the configured one; configure them to match and verify it succeeds.

**Acceptance Scenarios**:

1. **Given** a `hosted-api` embedder whose endpoint returns N-dim vectors, **When** `enrichment.embedder.dimension` is set to a different value, **Then** `embed()` throws an error naming the returned dimension and the configured one (telling the operator to set `dimension` to N).
2. **Given** `dimension` set to the model's true output length, **When** `embed()` runs, **Then** the returned vectors pass validation and are used for indexing/search.

---

### Edge Cases

- A real (injected or hosted) embedder — the stub warning MUST NOT fire, so genuine runs and the test suite stay quiet.
- A query whose expected dataset ids do not appear in the top-K — it is counted as a miss and surfaced in `misses[]` with its `expected` vs `got`, never silently dropped from the totals.
- An empty or schema-invalid query set — the CLI exits 2 before scoring, rather than reporting a misleading `recall = 0` over zero queries.
- A query set whose `expected` ids are absent from the indexed corpus — the eval smoke validates that every `expected` id exists in the corpus, so fixture drift is caught as a test failure, not as a spurious recall regression.
- An English query against a Cyrillic-titled dataset — there is zero FTS overlap, so any hit is necessarily from the semantic vector path (`matchKind='semantic'`); this is the cross-lingual case the bg/en split exists to measure.
- The live query-set example (`live-query-set.example.json`) references real-portal ids absent from any CI corpus — it is committed as a documented template for live eval, NOT wired as a CI input.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `enrichment.embedder` MUST gain an optional `dimension` field, recorded in `embeddings_meta`; a change vs the stored value MUST drive a full vector re-embed via `run-index`'s model-change path.
- **FR-002**: A single shared `buildEmbedder(embedderConfig)` factory (`src/index/embedders/factory.ts`) MUST select `HostedApiEmbedder` vs `LocalOnnxEmbedder` and MUST be used by `danni index`, `danni search`, AND `danni eval`, so the three never drift on provider selection; it MUST thread `dimension` and `maxBatchSize`.
- **FR-003**: `HostedApiEmbedder` MUST validate that the returned vector length equals the configured `dimension` and throw on mismatch (otherwise `cosine()` returns 0 on a length mismatch and search silently degrades to keyword-only).
- **FR-004**: A backend-agnostic recall harness (`src/index/eval.ts` `evaluateRecall`) MUST compute `recall@K` overall, split by language `{bg,en}`, plus the misses (expected vs retrieved), over the real hybrid `search()`.
- **FR-005**: A `danni eval` CLI MUST provide `--query-set <path>` (zod-validated), `--limit` (1..50, default 5), `--min-recall` (0..1, exit 3 if below — gating on SC-004), and `--json`; it MUST exit 0 on success, 2 on a bad flag or query-set, and 3 below the recall floor.
- **FR-006**: When the `local-onnx` hash stub is used (no injected `embedFn`), a stderr warning naming the stub model id MUST be emitted at the CLI boundary (in `buildEmbedder`), NOT in the embedder ctor (which tests use legitimately).

### Key Entities

- **EmbedderConfig** (`src/config/schema.ts`): gains an optional `dimension` (int 1..8192). `embeddings_meta(model_id, dimension)` already exists; `run-index` re-embeds when the embedder's id or `dimension` differs from the stored meta. No schema migration is added.
- **RecallReport** (`src/index/eval.ts`): `{ limit, total, hits, recallAtK, byLang:{bg,en:{total,hits,recall}}, misses:[{query,lang,expected,got}] }`. An internal shape (not a published contract). `RecallQuery` is `{ query, lang:'bg'|'en', expected:string[], rationale? }`; a query counts as a hit when ANY of its `expected` ids appears in the top-K.
- **buildEmbedder factory** (`src/index/embedders/factory.ts`): selects `HostedApiEmbedder` (OpenAI-compatible POST `{input,model}` → `{data:[{embedding}]}`) vs `LocalOnnxEmbedder`, threads `dimension`/`maxBatchSize`, and warns once when the result is the stub.
- **LocalOnnxEmbedder.isStub** (boolean): `true` when no real `embedFn` is injected; read by the factory to decide whether to warn.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Switching `enrichment.embedder.provider` from the stub to a real model and running `danni index` re-embeds every active dataset via the model-change path; verified live — 100 datasets re-embedded in 4 batches in ~2s.
- **SC-002**: The eval CI smoke (`tests/integration/eval-smoke.test.ts`) runs `evaluateRecall` over the shipped query set with the stub and stays ≥0.75 (the CI floor), green offline.
- **SC-003**: Against a real multilingual embedder on the real mirror, `recall@5` ≥0.90 (SC-004): verified live against a vLLM-served Qwen3-Embedding-8B (4096-dim), `recall@5 = 100%` (38/38), including 8/8 English→Bulgarian.
- **SC-004**: Cross-lingual recall works via the semantic vector path — an English query has zero FTS overlap with a Cyrillic title, so those hits are pure vector, confirmed `matchKind='semantic'`.

## Assumptions

- This is a retrofit: the work is already shipped and verified, so the spec is written in the settled tense and marked Implemented.
- No new database migration: `embeddings_meta(model_id, dimension)` already exists and `dimension` is an additive config field.
- No new external contract and therefore no `contracts/` directory (matching 002, 003, and 005): the eval report (`RecallReport`) is an internal shape, search results already conform to `index-entry.schema.json`, and the `danni eval` CLI is recorded in the existing `cli.md` contract.
- Builds on the existing pipeline (`sync` → `curate` → `enrich` → `index` → `search` over SQLite) and the prior embedder plumbing: the `Embedder` interface, the OpenAI-compatible `HostedApiEmbedder`, batched embedding, and the `run-index` model-change re-embed already existed (from 002); this feature wires a real backend through config and adds the eval harness.
- The chosen production backend is a LOCAL OpenAI-compatible server reached through the existing `hosted-api` provider (e.g. vLLM serving Qwen3-Embedding-8B), so there is no new native dependency and no data egress; bundling `onnxruntime-node` and defaulting to hosted OpenAI were both rejected.
- CI tests are deterministic and offline (the `local-onnx` stub / a fake fetcher) over a small committed corpus fixture (`tests/fixtures/search/cross-lang-corpus.ts`); the real ≥0.90 recall number is operational — run against a real embedder and the real mirror, and recorded in `docs/semantic-search.md`. The CI sandbox cannot reach the private-LAN embedding server.
- The `live-query-set.example.json` fixture is a documented real-id template captured from the 100-dataset live run, not a CI input.
- Out of scope: bundling a real on-device ONNX model, any schema or external-contract change, and any retrieval-fusion changes (RRF over the existing FTS5 + vector legs is unchanged) — this feature makes the vector leg real and adds the measurement instrument, it does not re-tune ranking.
