---
description: "Task list for 006-semantic-embedding-eval"
---

# Tasks: Real Multilingual Embedder + Recall Evaluation

> **Status (2026-06-05): Implemented.** Every task below is complete and exercised by the test suite (lint + typecheck clean; the eval CI smoke is green offline). This was a RETROFIT: the work shipped in commits `b11398e` (Track B — embedder wiring + eval harness) and `d75007f` (eval CI smoke + live query-set example) before the spec/plan/tasks records were written, then these artifacts were reconciled against the green suite and the changed source rather than re-derived task-by-task (research.md R5). The `Embedder` interface, the OpenAI-compatible `HostedApiEmbedder`, batched embedding, and the model-change re-embed in `run-index` already existed (from 002); this feature wires a real backend through config and adds the recall instrument.

**Input**: Design documents from `/specs/006-semantic-embedding-eval/`
**Prerequisites**: plan.md, spec.md, research.md (R1–R6), data-model.md, quickstart.md

**Tests**: Tests are MANDATORY for this feature (Constitution Principles VII, VIII: 100% line + branch coverage, TDD — write failing tests FIRST). This feature adds **no new DB migration** (`dimension` is additive config; `embeddings_meta(model_id, dimension)` already exists and `run-index` re-embeds when `embedder.id` or `.dimension` differs from the stored meta) and **no new published read contract** — the `RecallReport` shape emitted by the eval harness is an **internal** shape, and search results still conform to the existing `index-entry.schema.json`. So — exactly like 002, 003, and 005 — there is **no `contracts/` directory and no parity-matrix entry to add** (research.md R6); instead the mandatory tests are the `evaluateRecall` unit test, the `buildEmbedder` factory test, the `danni eval` `parseFlags`/`run()` tests, and the eval CI smoke over the shipped query set with the stub.

## Implementation status

Complete. All tasks below are `[x]` — implemented and verified by the test suite (see the status note above).

**Organization**: Tasks are grouped by user story (US1 = P1 real semantic vectors via config, US2 = P1 measure recall, US3 = P2 no silent stub, US4 = P2 loud misconfiguration) to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Different files, no dependencies on incomplete tasks in the same phase
- **[Story]**: User-story phase tasks only (US1–US4)
- Every task includes an exact file path
- **TDD**: every test task is written and made to FAIL before the implementation it guards

## Path Conventions

Single-project layout (inherited from 001, plan.md §Project Structure):
- New source: `src/index/embedders/factory.ts` (shared embedder factory), `src/index/eval.ts` (recall harness), `src/cli/eval.ts` (the `danni eval` command)
- Modified source: `src/config/schema.ts` (the optional `dimension` field), `src/index/embedders/hosted-api.ts` (dimension validation), `src/cli/search.ts` + `src/cli/index-cmd.ts` (rewired onto the factory), `src/cli/danni.ts` (the `eval` subcommand)
- No new migration (no schema change); no `contracts/` directory (the eval report is an internal shape; search results reuse `index-entry.schema.json`)
- Tests: `tests/unit/index/embedders/factory.test.ts`, `tests/unit/index/eval.test.ts`, `tests/unit/cli/eval.test.ts`, `tests/integration/eval-smoke.test.ts`; fixtures `tests/fixtures/search/cross-lang-corpus.ts`, `tests/fixtures/search/live-query-set.example.json`
- Docs: `docs/semantic-search.md` (new), `specs/001-egov-data-sync/contracts/cli.md` (the `danni eval` entry)
- Read-only deps: `src/index/embedder.ts` (`Embedder`), `src/index/query.ts` (`search()`), `src/index/embedders/local-onnx.ts` (`isStub`, from 005), `src/config/loader.ts`, `src/store/db.ts`

---

## Phase 1: User Story 1 — Real semantic vectors via config (Priority: P1) 🎯 MVP

**Goal**: An operator points `enrichment.embedder` at a real model — a hosted API or a local OpenAI-compatible server — by editing config, and a single re-index swaps the stub for the real model with no code change. `dimension` becomes a first-class config field recorded in `embeddings_meta`, so a change vs the stored value drives a full vector re-embed via `run-index`'s model-change path. A single shared `buildEmbedder` factory selects the provider for `danni index`, `danni search`, AND `danni eval` so the three never drift (FR-001, FR-002).

**Independent Test** (quickstart §1): switching `enrichment.embedder.provider` from `local-onnx` to `hosted-api` and re-running `danni index` re-embeds every active dataset (model-change path); `danni index`, `danni search`, and `danni eval` all resolve the embedder through the same factory.

### Implementation for User Story 1

- [x] T001 [P] [US1] Add the optional `dimension` field (`z.number().int().min(1).max(8192).nullable().optional()`) to `EmbedderConfigSchema` in `src/config/schema.ts`; it is recorded in `embeddings_meta` and a change vs the stored value drives a full vector re-embed via `run-index`'s existing model-change path (FR-001, research.md R2).
- [x] T002 [US1] Extract the shared `buildEmbedder(embedderConfig)` factory in `src/index/embedders/factory.ts` selecting `HostedApiEmbedder` (`provider:'hosted-api'`) vs `LocalOnnxEmbedder`, threading `dimension` + `maxBatchSize`; rewire `src/cli/search.ts` and `src/cli/index-cmd.ts` onto it so the three commands never drift on provider selection, and emit the stub warning once at this boundary when the resolved `LocalOnnxEmbedder.isStub` is true (FR-002, FR-006; the warning lives here, not the embedder ctor — research.md R3). (Depends on T001.)

**Checkpoint**: switching `enrichment.embedder.provider` stub→real plus `danni index` re-embeds every active dataset via the model-change path (verified live: 100 datasets re-embedded in 4 batches, ~2s — SC-001); all three commands share one provider selection.

---

## Phase 2: User Story 2 — Measure recall (Priority: P1)

**Goal**: An operator or CI runs a labelled query set and gets recall@K overall and split by language (BG/EN), with the per-query misses (expected vs retrieved), to know whether SC-004 is met. The harness is backend-agnostic — it measures whatever embedder is wired through the factory over the real hybrid `search()` — so it doubles as the validation instrument for the embedder swap (FR-004, FR-005, research.md R4).

**Independent Test** (quickstart §2): `evaluateRecall` over a labelled query set returns `recallAtK`, `byLang:{bg,en}`, and `misses`; `danni eval --query-set <path>` prints the same overall/per-language numbers, gates on `--min-recall` (exit 3 below the floor), and emits the full report under `--json`.

### Tests for User Story 2 (TDD — write FIRST, ensure they FAIL) ⚠️

- [x] T003 [P] [US2] Add the recall harness unit test in `tests/unit/index/eval.test.ts`: `evaluateRecall` scores recall@K over a labelled query set, counts a hit when ANY `expected` id appears in the top-K, splits `byLang` into `{bg,en}` with per-language `recall`, and surfaces each `miss` as `{query,lang,expected,got}` (guards T004).
- [x] T004 [P] [US2] Add the CLI flag/run tests in `tests/unit/cli/eval.test.ts`: `parseFlags` validates `--query-set` (required path), `--limit` (1..50, default 5), `--min-recall` (0..1), and `--json`, rejecting bad flags; `run()` returns `0` on success, `2` on a bad flag or invalid/unreadable query-set file, and `3` when `recall@K` is below `--min-recall` (guards T006).
- [x] T005 [P] [US2] Add the factory test in `tests/unit/index/embedders/factory.test.ts`: `buildEmbedder` selects `HostedApiEmbedder` vs `LocalOnnxEmbedder` by `provider`, threads `dimension` + `maxBatchSize`, and the resolved stub exposes `isStub` (guards T002).

### Implementation for User Story 2

- [x] T006 [US2] Create the backend-agnostic recall harness in `src/index/eval.ts`: `evaluateRecall({db, embedder, queries, limit?})` runs each `RecallQuery` through the real hybrid `search()` and returns the `RecallReport` `{ limit, total, hits, recallAtK, byLang:{bg,en:{total,hits,recall}}, misses:[{query,lang,expected,got}] }`. Internal shape only — no schema, no parity-matrix entry. `recallAtK` is the SC-004 metric; the language split is the cross-lingual axis (FR-004, research.md R4). Satisfies T003. (Depends on T002.)
- [x] T007 [US2] Add the `danni eval` CLI in `src/cli/eval.ts`: `--query-set <path>` (zod-validated `{ queries: [{ query, lang: bg|en, expected: [datasetId], rationale? }] }`), `--limit` (1..50, default 5), `--min-recall` (0..1, exit 3 below — gates on SC-004), and `--json`; exit `0` ok, `2` bad flag or invalid query-set, `3` below the floor. Build the embedder through the shared factory and report overall + per-language recall with the misses listed. Register the `eval` subcommand in `src/cli/danni.ts` (FR-005). Satisfies T004. (Depends on T002, T006.)

**Checkpoint**: `evaluateRecall` and `danni eval` report recall@K overall and split by BG/EN with the misses, gating on `--min-recall`. Verified live against vLLM Qwen3-Embedding-8B (4096-dim): recall@5 = 100% (38/38), incl. 8/8 English→Bulgarian (SC-003 / SC-004).

---

## Phase 3: User Story 3 — No silent stub (Priority: P2)

**Goal**: When search/index/eval fall back to the deterministic `local-onnx` hash stub (no injected `embedFn`), a stderr warning naming the stub model id fires so its meaningless vectors aren't mistaken for real semantic ones. The warning lives at the CLI boundary — the shared `buildEmbedder` factory — not the `LocalOnnxEmbedder` constructor (which tests use legitimately), and stays silent for an injected real `embedFn` or `hosted-api` (FR-006, research.md R3).

**Independent Test** (quickstart §3): running `danni search`/`danni index`/`danni eval` on the default (`local-onnx`) config prints a stub warning to stderr naming the stub model id; the `hosted-api` and injected-`embedFn` paths are silent.

### Implementation for User Story 3

- [x] T008 [US3] Emit the stub warning at `buildEmbedder()` in `src/index/embedders/factory.ts` when the resolved `LocalOnnxEmbedder.isStub` is true — a single stderr line naming the stub model id (`embedder.id`) and pointing at `enrichment.embedder.provider='hosted-api'` for genuine semantic vectors; the `hosted-api` and injected-`embedFn` paths stay silent. Because all three commands resolve through this one factory, none can silently use the stub (FR-006, research.md R3). (Folded into T002; recorded as its own task per FR-006.)

**Checkpoint**: any command that resolves to the hash stub prints one stub warning naming the stub model id; injected real embedders and `hosted-api` are silent (SC-002 / US3).

---

## Phase 4: User Story 4 — Loud misconfiguration (Priority: P2)

**Goal**: If the configured `dimension` doesn't match the model's actual vector length, indexing fails fast rather than silently degrading search to keyword-only — `cosine()` returns 0 for vectors of differing length, so a wrong `dimension` would turn semantic ranking off without any error. `HostedApiEmbedder` validates the API's returned vector length against the declared `dimension` and throws on mismatch (FR-003, research.md R2).

**Independent Test** (quickstart §4): a `hosted-api` embedder whose endpoint returns vectors of a length other than the configured `dimension` throws on embed (naming the observed vs declared length) instead of producing zero-similarity vectors.

### Tests for User Story 4 (TDD — write FIRST, ensure they FAIL) ⚠️

- [x] T009 [US4] Add the dimension-mismatch case to `tests/unit/index/embedders/factory.test.ts` / the hosted-api path: a `HostedApiEmbedder` whose mock endpoint returns a vector whose length differs from the configured `dimension` throws (guards T010).

### Implementation for User Story 4

- [x] T010 [US4] Make `HostedApiEmbedder` validate that the returned vector length equals the configured `dimension` and throw on mismatch in `src/index/embedders/hosted-api.ts` (the declared dimension is the contract; otherwise `cosine()` returns 0 on a length mismatch and search silently degrades to keyword-only — FR-003, research.md R2). Satisfies T009.

**Checkpoint**: a `dimension` that disagrees with the model's actual vector length fails indexing fast with a message naming the observed vs declared length, instead of silently degrading search (SC-001 corollary / US4).

---

## Phase 5: CI smoke, fixtures & docs

**Goal**: A green-offline CI smoke that runs the recall harness over the shipped query set with the stub (CI floor ≥0.75), a committed cross-lingual corpus fixture, a real-id query-set template captured from the live run, and operator docs for configuring a real embedder and running `danni eval`. The real 0.90 number (SC-004) is operational — recorded in `docs/semantic-search.md`, not asserted in CI (research.md R5).

### Tests / fixtures for Phase 5

- [x] T011 [P] Add the shared cross-lingual corpus fixture `tests/fixtures/search/cross-lang-corpus.ts` (`CROSS_LANG_CORPUS` + `seedCrossLangCorpus(db)`) — a small committed corpus for offline recall/cross-lang tests.
- [x] T012 Add the eval CI smoke `tests/integration/eval-smoke.test.ts`: seed the cross-lang corpus, run `evaluateRecall` over the shipped query set with the stub embedder, and assert `recallAtK >= 0.75` (the CI floor) with the language split, green offline (FR-004, SC-002, research.md R5). (Depends on T006, T011.)
- [x] T013 [P] Commit the real-id query-set template `tests/fixtures/search/live-query-set.example.json` (the BG/EN + English→Bulgarian query set captured from the live run, as the operator-facing template for `danni eval`).

### Docs

- [x] T014 [P] Add `docs/semantic-search.md`: configure a real embedder (the local OpenAI-compatible server / Qwen example), the `dimension` contract, and how to run `danni eval`; record the operational SC-004 result (recall@5 ≥0.90 against the real mirror).
- [x] T015 [P] Add the `danni eval` entry to `specs/001-egov-data-sync/contracts/cli.md`: flags (`--query-set`, `--limit`, `--min-recall`, `--json`) and exit codes (`0` ok / `2` bad flag or query-set / `3` below `--min-recall`).

**Checkpoint**: the eval CI smoke is green offline at the ≥0.75 floor over the shipped query set; the cross-lang corpus + live-query-set template are committed; `docs/semantic-search.md` and the `cli.md` `danni eval` entry document the operator path and the SC-004 result.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (US1)** → the config field + shared factory. T001 (`dimension` in schema) → T002 (factory + rewire search/index-cmd, stub warning). The factory is the spine the rest of the feature hangs off.
- **Phase 2 (US2)** → the recall harness + CLI. T003 ∥ T004 ∥ T005 (tests) written first; T006 (`evaluateRecall`) → T007 (`danni eval` CLI), both depending on the factory (T002).
- **Phase 3 (US3)** → the stub warning, folded into the factory (T008 = the warning recorded against FR-006); no code dependency beyond T002.
- **Phase 4 (US4)** → the dimension validation. T009 (test) → T010 (`HostedApiEmbedder` throw). Independent of US2.
- **Phase 5** → after the harness lands (it exercises `evaluateRecall`): T011/T013/T014/T015 are independent committed artifacts; T012 (smoke) depends on T006 + T011.

### User Story Dependencies

- **US1 (P1)** — the `dimension` config + shared `buildEmbedder` factory. The foundation; the other stories build on the factory.
- **US2 (P1)** — the recall harness + `danni eval`; depends on US1's factory for the embedder it measures.
- **US3 (P2)** — the stub warning at the factory boundary; folded into US1's factory (research.md R3).
- **US4 (P2)** — the hosted-api dimension validation; independent of US2/US3.

### Parallel Opportunities

- **Phase 2 tests**: T003 (`eval.test.ts`) ∥ T004 (`cli/eval.test.ts`) ∥ T005 (`factory.test.ts`) — disjoint files, written before their implementations.
- **Phase 5**: T011 (corpus fixture) ∥ T013 (live-query-set template) ∥ T014 (docs) ∥ T015 (cli.md) touch disjoint files; T012 (smoke) lands after T006 + T011.
- Across stories, US4 (T009/T010 on `hosted-api.ts`) is disjoint from US2's harness/CLI files and could proceed in parallel once the factory (T002) is in place.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in the same phase.
- [Story] label maps each task to its user story (US1–US4).
- Tests are MANDATORY and TDD (Constitution VII/VIII): write failing tests first, 100% line + branch coverage. There is **no new migration** (`dimension` is additive config; `embeddings_meta` already exists and `run-index` re-embeds on a model/dimension change) and **no new published read contract** (the `RecallReport` is internal; search results reuse `index-entry.schema.json`) — so there is **no `contracts/` directory and no parity-matrix entry**, exactly like 002, 003, and 005 (research.md R6).
- The shared `buildEmbedder` factory makes index/search/eval drift on provider selection impossible (FR-002); it is also the single place the stub warning fires, so the warning lives at the CLI boundary, not the `LocalOnnxEmbedder` constructor that tests use legitimately (research.md R3).
- `dimension` is config, not auto-detected (research.md R2), so the model-change re-embed is deterministic and `HostedApiEmbedder` can validate the API's output against the declared contract — a mismatch throws (FR-003) rather than letting `cosine()` silently return 0.
- The recall harness is backend-agnostic (research.md R4): the CI smoke runs it over the stub at a ≥0.75 floor (green offline); the real recall@5 ≥0.90 SC-004 number is operational (a real embedder + the real mirror — verified live against vLLM Qwen3-Embedding-8B) and recorded in `docs/semantic-search.md`, not asserted in CI (research.md R5).
- Commit after each task or logical group; stop at any checkpoint to run `bun test --coverage` and validate before proceeding.
