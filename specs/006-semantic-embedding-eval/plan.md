# Implementation Plan: Real Multilingual Embedder + Recall Evaluation

**Branch**: `006-semantic-embedding-eval` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-semantic-embedding-eval/spec.md`
**Status**: Implemented (shipped in `b11398e` Track B + `d75007f` eval CI smoke; verified by the test suite, 2026-06-05)

## Summary

danni-bg's search is hybrid: a real FTS5 keyword leg fused with a vector-cosine leg via RRF.
The keyword leg was always real, but the vector leg shipped (from 001/002) behind a deterministic
hash **stub** (`local-onnx:hash-stub-32`) whose vectors carry no meaning — so semantic and
cross-lingual ranking were not actually working. This feature does two things and only two things:

1. **Makes the vector leg real, by config (US1, P1).** An operator points
   `enrichment.embedder` at a real model — a hosted API or a local OpenAI-compatible server —
   and a single `danni index` swaps the stub for the real model with **no code change**, via the
   existing model-change re-embed path in `run-index.ts`. The `Embedder` interface, the
   OpenAI-compatible `HostedApiEmbedder`, batched embedding, and the model-change re-embed already
   existed (002); this wires a real backend through config and removes the duplicated provider
   selection so the three call sites cannot drift.
2. **Adds the instrument to measure retrieval quality (US2, P1).** A backend-agnostic recall
   harness (`evaluateRecall`) and a `danni eval` CLI compute **recall@K overall and split by
   language (BG/EN)** with the per-query misses, so the embedder swap can be validated against
   **SC-004** (spec 001's criterion: locate the most relevant dataset in the top 5 for ≥90% of a
   representative BG/EN query set).

Two operability guards round it out: a stderr warning when the hash stub is in use so meaningless
vectors are never mistaken for real ones (US3, P2), and a fail-fast when the configured dimension
does not match the model's actual vector length (US4, P2) — otherwise `cosine()` returns 0 on a
length mismatch and search silently degrades to keyword-only.

There is **no new DB migration and no new external read contract**. `dimension` is additive
config (recorded in the already-existing `embeddings_meta`); the recall report is an internal
shape; search results still conform to the index-entry contract owned by 001. Therefore no
`contracts/` directory — exactly like 002, 003, and 005.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, `noUncheckedIndexedAccess`, no `any`
outside type guards) — unchanged from 001.
**Primary Dependencies**:
- Runtime: Bun 1.x with `bun:sqlite` (existing `openDb` in `src/store/db.ts`).
- Embedder stack: existing `Embedder` interface (`src/index/embedder.ts`), `HostedApiEmbedder`
  (`src/index/embedders/hosted-api.ts`), `LocalOnnxEmbedder` (`src/index/embedders/local-onnx.ts`),
  the batcher (`resolveBatchSize`), and the model-change re-embed path (`run-index.ts`,
  `embeddings_meta` + `index_state.model_id`) — composed and threaded, not redesigned.
- Search: existing hybrid `search()` (`src/index/query.ts`) — FTS5 + vector cosine fused with RRF;
  the eval harness calls it unchanged.
- Validation: Zod ^3.25.x. **No new config schema file** — `EmbedderConfigSchema`
  (`src/config/schema.ts`) gains one additive optional field, `dimension`; the `danni eval`
  query-set is validated by a local zod schema in `src/cli/eval.ts`.
- Testing: `bun test` + coverage per 001's Complexity Tracking decision (Vitest hangs under
  Bun with `bun:sqlite`).
- Lint/Format: Biome.

**Storage**: **No new table, no migration, no on-disk blob change.** `embeddings_meta(model_id,
dimension)` already exists (002); `run-index.ts` already re-embeds when `embedder.id` **or**
`embedder.dimension` differs from the stored meta — this feature only feeds a real `id`/`dimension`
into that existing decision.

**Testing**: `bun test` against in-memory/temp SQLite stores. All new tests are deterministic and
offline (Principle VI): the `HostedApiEmbedder` dimension-validation test uses an injected
recording `fetcher`; the eval unit/CLI tests and the CI smoke use the deterministic
`LocalOnnxEmbedder` stub over a small committed fixture corpus. The real recall@5 ≥0.90 number is
**operational** — measured against a real embedder + the real mirror, recorded in
`docs/semantic-search.md`, not asserted in CI (the model server is on a private LAN the sandbox
cannot reach).

**Target Platform**: Linux server / macOS dev — unchanged from 001.

**Project Type**: Single project — CLI + library. The work spans `src/index/embedders/`,
`src/index/`, `src/cli/`, and `src/config/`.

**Performance Goals**: No new hot path in indexing or search. `evaluateRecall` runs one `search()`
per labelled query (the query set is small, ~38 live / a handful in CI). The factory adds no
per-request cost. SC-001 verified live: switching the provider stub→real and running `danni index`
re-embedded 100 datasets in 4 batches in ~2s.

**Constraints**:
- 100% line + branch coverage (Principle VIII): every new branch is covered — both factory
  provider arms, the stub-warning vs injected-`embedFn` paths, the `HostedApiEmbedder`
  dimension-match vs mismatch throw, the eval misses-present vs all-hit paths, and every
  `danni eval` flag/exit-code branch (`0`/`2`/`3`).
- The configured `dimension` is the **contract** the API must honor (FR-003): a mismatch throws
  with a message naming both the returned and configured dimension, rather than degrading silently.
- The stub warning fires at the **CLI boundary** (the factory), never in the `LocalOnnxEmbedder`
  constructor — tests construct the stub legitimately and a ctor warning would spam/mislead (R3).
- Cyrillic preserved byte-exact (Principle X): the cross-lingual axis is the whole point — an
  English query has zero FTS overlap with a Cyrillic title, so those hits are pure vector
  (`matchKind='semantic'`).

**Scale/Scope**: Confined to two capabilities (real embedder by config + recall instrument) plus
two operability guards. No schema change, no migration, no external contract change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence in this plan |
|---|-----------|--------|------------------------|
| I | AI-Native Development | ✅ PASS | The vector leg now carries real semantic meaning, making the structured search result *more* machine-trustworthy. No authoritative portal data is mutated — only the derived embedding vectors are recomputed by the existing model-change path. |
| II | Spec-Driven Development | ✅ PASS | spec.md (WHAT, four user stories) → this plan + research.md (HOW, R1–R6) → tasks.md → `bun test` + the live SC-004 run (VALIDATION). |
| III | Contract-First API Design | ✅ PASS | **No new contract.** `dimension` is additive config; the `RecallReport` is an *internal* shape (typed in `src/index/eval.ts`, not published); search results still conform to `index-entry.schema.json` (owned by 001). `danni eval` is documented in the existing CLI contract (`contracts/cli.md`). No new MCP tool, no new portal endpoint (R6) → no `contracts/` dir. |
| IV | Operational Excellence | ✅ PASS | Two operability surfaces: the stub warning (FR-006) tells the operator on stderr that semantic ranking is meaningless and how to fix it; the dimension-mismatch throw (FR-003) fails fast instead of silently degrading to keyword-only. `danni eval` is the operator's instrument to confirm SC-004 with documented exit codes (`0`/`2`/`3`). |
| V | Simplicity & YAGNI | ✅ PASS | The minimal change: one additive config field, one shared `buildEmbedder` factory replacing two duplicated copies, one dimension check, one backend-agnostic harness, one CLI. The production backend reuses `HostedApiEmbedder` against a local OpenAI-compatible server — **no new dependency, no data egress** (R1 rejected bundling `onnxruntime-node` and rejected hosted OpenAI as default). |
| VI | Fast Feedback Loops | ✅ PASS | All new tests are offline + deterministic: injected `fetcher` for the hosted-api dimension test, the hash-stub embedder + a small committed corpus for the eval unit/CLI/smoke tests. The 0.90 SC-004 number is operational (real embedder + real mirror), kept out of CI (R5). `bun test` stays fast. |
| VII | Type Safety & Validation | ✅ PASS | `EmbedderConfig.dimension` is `z.number().int().min(1).max(8192)` optional; the `danni eval` query-set is zod-validated (`{ query, lang: bg\|en, expected: [string], rationale? }`); `RecallReport`/`RecallQuery`/`QueryMiss` are explicit interfaces; `LocalOnnxEmbedder.isStub` is a `readonly boolean`. No `any`, no new JSON columns. |
| VIII | 100% Test Coverage & Endpoint Parity | ✅ PASS | TDD per capability: the harness unit test (T004) and the factory test (T002) precede their modules; the dimension-validation test precedes the throw (T003); the CLI `parseFlags`/`run` tests and the CI smoke (T005–T006) guard the command and the SC-004 instrument. Parity matrix unaffected (no new endpoint). Suite: 781 pass / 0 fail (758 after Track B, +23 with the eval smoke). |
| IX | Data Freshness & Sync Integrity | ✅ PASS | The model-change re-embed is the integrity mechanism: changing `embedder.id` or `embedder.dimension` re-embeds every active dataset so persisted vectors never silently belong to a different model (FR-001). No authoritative field is mutated. |
| X | Bulgarian-Locale Awareness | ✅ PASS | The cross-lingual axis is first-class: recall is split `{bg,en}`, and SC-004 was verified live including 8/8 English→Bulgarian hits via the pure-semantic path (zero FTS overlap with the Cyrillic title → `matchKind='semantic'`). Cyrillic query/title text passes through byte-exact. |
| XI | Respectful Crawling | ✅ PASS | Out of scope — this feature touches the index/search/eval path, not the crawler. The embedder talks only to the configured `/embeddings` endpoint (a local server by default → no third-party egress). |

**Result**: All gates PASS. No new violations and no new Complexity Tracking entries beyond
the inherited `bun test` decision (001).

## Project Structure

### Documentation (this feature)

```text
specs/006-semantic-embedding-eval/
├── plan.md              # This file
├── research.md          # Phase 0 output (R1–R6)
├── data-model.md        # EmbedderConfig.dimension + RecallReport internal shape
├── quickstart.md        # Configure a real embedder + run danni eval + SC checklist
├── spec.md
└── tasks.md             # Created by /speckit-tasks
```

No `contracts/` directory — exactly like 002, 003, and 005. This feature adds no MCP tool, no
portal endpoint, and no new published read contract. `dimension` is additive config, the recall
report is an internal shape, and search results already conform to the index-entry schema (owned
by 001). `danni eval` is recorded in the existing CLI contract (`contracts/cli.md`, owned by 001).

### Source Code (repository root)

Files to **add**:

```text
src/index/embedders/
└── factory.ts                        # NEW — buildEmbedder(embedderConfig): the single shared
                                        #   provider selection (hosted-api → HostedApiEmbedder |
                                        #   local-onnx → LocalOnnxEmbedder), threading dimension +
                                        #   maxBatchSize and emitting the stub warning once (FR-002,
                                        #   FR-006)

src/index/
└── eval.ts                           # NEW — evaluateRecall(): recall@K over the real hybrid
                                        #   search(), split by language {bg,en}, with misses;
                                        #   RecallQuery / QueryMiss / LangRecall / RecallReport (FR-004)

src/cli/
└── eval.ts                           # NEW — `danni eval`: parseFlags + run(); --query-set (zod-
                                        #   validated), --limit (1..50, default 5), --min-recall
                                        #   (0..1, exit 3), --json; exit 0/2/3 (FR-005)

docs/
└── semantic-search.md                # NEW — configure a real embedder (local OpenAI-compatible
                                        #   server, the Qwen3-Embedding-8B example + probe), the
                                        #   model-change re-embed note, and running `danni eval`

tests/unit/index/
└── eval.test.ts                      # NEW — evaluateRecall recall@K / byLang / misses

tests/unit/cli/
└── eval.test.ts                      # NEW — parseFlags (flag/exit-2 cases) + run() (exit 0/2/3)

tests/unit/index/embedders/
└── factory.test.ts                   # NEW — provider selection + dimension/maxBatchSize threading
                                        #   + the stub-warning vs injected-embedFn paths

tests/integration/
└── eval-smoke.test.ts                # NEW — CI smoke: evaluateRecall over the shipped query-set
                                        #   against the corpus with the stub (recall@5 ≥0.75 floor +
                                        #   bg/en split); asserts the query-set is well-formed (every
                                        #   expected id exists in the corpus → catches fixture drift)

tests/fixtures/search/
├── cross-lang-corpus.ts              # NEW — the shared bilingual corpus the query-set is written
                                        #   against (single source of truth; search-cross-lang imports it)
└── live-query-set.example.json       # NEW — real-id query-set from the 100-dataset live capture
                                        #   (30 BG + 8 EN); a documented template, NOT a CI input
```

Files to **modify**:

```text
src/config/schema.ts                  # Add optional `dimension` to EmbedderConfigSchema
                                        #   (z.number().int().min(1).max(8192).nullable().optional();
                                        #   unset → provider default: local-onnx 32, hosted-api 384)
src/cli/search.ts                     # Rewire onto buildEmbedder(config.enrichment.embedder)
                                        #   (drop the local copy)
src/cli/index-cmd.ts                  # Rewire onto buildEmbedder() (drop the local copy)
src/index/embedders/hosted-api.ts     # Validate returned vector length === configured dimension;
                                        #   throw on mismatch naming both dims (FR-003)
src/cli/danni.ts                       # Register the `eval` command + help line
specs/001-egov-data-sync/contracts/cli.md  # Add the `danni eval` entry (flags + exit codes)
tests/integration/search-cross-lang.test.ts # Import the shared cross-lang-corpus fixture instead of
                                        #   inlining a copy (no drift)
```

Files **read but not modified** (depended upon):

```text
src/index/embedder.ts                  # Embedder interface (id, dimension, maxBatchSize, embed)
src/index/embedders/local-onnx.ts      # LocalOnnxEmbedder.isStub (already exposed by 005)
src/index/query.ts                     # hybrid search() — the harness calls it unchanged
src/index/run-index.ts                 # model-change re-embed (embeddings_meta + index_state.model_id)
src/config/loader.ts                   # loadConfig()
src/store/db.ts                        # openDb()
```

**Structure Decision**: Single-project layout (inherited from 001). The shared `buildEmbedder`
lives in `src/index/embedders/factory.ts` next to the embedder implementations it selects, so
`danni index`, `danni search`, and `danni eval` import one seam and cannot drift on provider
selection (FR-002). The recall harness is a library function in `src/index/eval.ts` (so it is
unit-testable and reusable) wrapped by the thin `src/cli/eval.ts`. No new top-level directory.

## Implementation Phases

Ordered, TDD-first (the new/strengthened test precedes the code it guards, per Principle VIII).
The two capabilities (real embedder by config, recall instrument) share no ordering dependency
beyond test-before-code.

**Phase 0 — Research (done).** R1–R6 in research.md resolve: R1 keep the two providers
(`local-onnx` | `hosted-api`) and choose a **local** OpenAI-compatible server as the production
backend (reuses `HostedApiEmbedder`, no new dep, no egress — e.g. vLLM serving Qwen3-Embedding-8B;
rejected bundling `onnxruntime-node` as a heavy native dep and rejected hosted OpenAI as default);
R2 `dimension` as config (not auto-detected) so the model-change re-embed is deterministic and the
API output can be validated against a declared contract; R3 warn at the CLI boundary, not the
embedder ctor (tests construct the stub legitimately — `isStub` exposes state, the CLI decides);
R4 the recall harness is backend-agnostic so it doubles as the embedder-swap validator, recall@5
is the SC-004 metric, split by language is the cross-lingual axis (FR-014 of spec 001); R5 the CI
smoke uses the stub + a small committed corpus (floor ≥0.75) while the real 0.90 number is
operational and recorded in `docs/semantic-search.md`; R6 no migration, no new external contract.

**Phase 1 — Real semantic vectors via config (US1, P1).**
1. **T001** [P] Add optional `dimension` to `EmbedderConfigSchema` (`src/config/schema.ts`),
   `z.number().int().min(1).max(8192).nullable().optional()`; documented as recorded in
   `embeddings_meta` so a change drives the existing full re-embed; unset → provider default.
2. **T002** Add the `factory.test.ts` (provider selection, `dimension`/`maxBatchSize` threading,
   stub-warning vs injected-`embedFn`), then extract the shared `buildEmbedder` factory
   (`src/index/embedders/factory.ts`) and rewire `src/cli/search.ts` + `src/cli/index-cmd.ts` onto
   it, emitting the stub warning once at this boundary. (FR-002, FR-006)

**Phase 2 — Loud misconfiguration (US4, P2).**
3. **T003** Add the dimension-mismatch test (injected `fetcher` returning the wrong-length
   vector), then make `HostedApiEmbedder.embed` validate the returned vector length === configured
   `dimension` and throw a message naming both dims (`src/index/embedders/hosted-api.ts`). (FR-003)

**Phase 3 — Measure recall (US2, P1).**
4. **T004** [P] Add `tests/unit/index/eval.test.ts`, then implement `evaluateRecall`
   (`src/index/eval.ts`): one `search()` per labelled query, recall@K overall, `byLang:{bg,en}`,
   and the per-query `misses` (expected vs got). (FR-004)
5. **T005** Add the `parseFlags` + `run()` tests, then implement the `danni eval` CLI
   (`src/cli/eval.ts`): zod-validated `--query-set`, `--limit` (1..50, default 5), `--min-recall`
   (0..1 → exit `3` below the floor), `--json`; exit `0` ok / `2` bad flag or query-set / `3` below
   the recall floor; register it in `src/cli/danni.ts`. (FR-005)
6. **T006** Add the eval CI smoke (`tests/integration/eval-smoke.test.ts`) running `evaluateRecall`
   over the shipped query-set against a shared corpus fixture
   (`tests/fixtures/search/cross-lang-corpus.ts`) with the stub (recall@5 ≥0.75 floor + bg/en
   split + well-formed assertion); rewire `tests/integration/search-cross-lang.test.ts` onto the
   shared fixture; commit `tests/fixtures/search/live-query-set.example.json` (the real-id template
   captured from the live run). (R5)

**Phase 4 — Docs (US1/US2).**
7. **T007** Add `docs/semantic-search.md` (configure a local OpenAI-compatible server, the
   Qwen3-Embedding-8B example with a probe command + the model-change re-embed note, and how to run
   `danni eval` against the live example) and add the `danni eval` entry to
   `specs/001-egov-data-sync/contracts/cli.md`.

**Phase 5 — Gates & live validation.**
- **CI gates.** Full suite green with the additions (781 pass / 0 fail); Biome lint + typecheck
  clean; parity-matrix + migrate-smoke gates pass (neither is affected — no new endpoint, no new
  migration).
- **SC-001** verified live: switching `enrichment.embedder.provider` stub→real + `danni index`
  re-embedded all 100 active datasets via the model-change path (4 batches, ~2s).
- **SC-002** the CI smoke stays ≥0.75 with the stub, green offline.
- **SC-003 / SC-004** verified live against a vLLM Qwen3-Embedding-8B server (4096-dim):
  recall@5 = 100% (38/38), including 8/8 English→Bulgarian, with the cross-lingual hits confirmed
  as `matchKind='semantic'` (pure vector — an English query has zero FTS overlap with a Cyrillic
  title). Recorded in `docs/semantic-search.md`.
