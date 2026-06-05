# Phase 0 Research — 006-semantic-embedding-eval

**Date**: 2026-06-05
**Status**: Implemented. Records the decisions behind the shipped, verified work.

This feature is a **retrofit**: Track B (the embedder wiring + eval harness) was implemented and
verified — including a live run against a real multilingual embedder — *before* this artifact was
written. It shipped in two commits: `b11398e` (embedder factory + recall harness + `danni eval`)
and `d75007f` (eval CI smoke + the live query-set example). The unknown was never "what should the
behavior be" — spec 001 already set the target (**SC-004**: locate the most relevant dataset in the
top 5 for ≥90% of a representative BG/EN query set) — but "how to turn the always-present hash-stub
vector leg into a real semantic one **through config, with no code change**, and how to *measure*
whether the swap actually hits 0.90". There is **no new migration** and **no `contracts/`
directory** (exactly like 002, 003, and 005): `embeddings_meta(model_id, dimension)` already exists,
the new `dimension` is additive *config*, the recall report is an *internal* shape, and search
results already conform to the published `index-entry.schema.json`. Each decision below is in the
canonical **Decision / Rationale / Alternatives considered** form and is grounded in the code
actually read (`src/index/embedders/{factory,hosted-api,local-onnx}.ts`, `src/index/eval.ts`,
`src/cli/eval.ts`, `src/config/schema.ts`, `src/index/run-index.ts`, the eval CI smoke, the shared
corpus fixture, and the live query-set example).

---

## R1 — Two providers, but the production semantic backend is a *local* OpenAI-compatible server

**Decision**: The `enrichment.embedder.provider` enum keeps its two values, `local-onnx` and
`hosted-api` (`EmbedderConfigSchema`, `src/config/schema.ts`). The **chosen production backend for
real semantic vectors is a local OpenAI-compatible inference server reached through the existing
`hosted-api` provider** — i.e. `HostedApiEmbedder` (`src/index/embedders/hosted-api.ts`) pointed at
a `http://<host>:<port>/v1/embeddings` endpoint, not at a public cloud. It POSTs
`{ input: string[], model }` and reads `{ data: [{ embedding: number[] }] }`, the OpenAI embeddings
protocol that text-embeddings-inference, Ollama, vLLM, and LM Studio all speak. No new dependency
and no data egress: the corpus stays on the operator's own box. `local-onnx` remains the default and
is the deterministic hash stub (`LocalOnnxEmbedder`, `id = local-onnx:hash-stub-32`) until a real
`embedFn` is injected — real on-device ONNX bundling is deliberately *not* shipped here.

**Rationale**: The vector leg always existed in code; it just carried no meaning. Reusing
`hosted-api` to talk to a *local* server gets a genuine multilingual model into the pipeline with
zero new runtime surface — the `HostedApiEmbedder`, the batcher, and the model-change re-embed in
`run-index.ts` were all already built (from 002), so "make the vector leg real" reduces to "point
config at a server and re-index". Keeping the corpus on-box matches the project's "the store is the
source of truth" ethos and avoids shipping a large native dependency just to embed. Verified live
against **vLLM serving Qwen3-Embedding-8B (4096-dim)** on the operator's box (see R5/SC-003).

**Alternatives considered**:
- *Bundle `onnxruntime-node` + a model and make `local-onnx` real*: rejected for now — a heavy
  native dependency (platform-specific binaries, model weights to vendor and load) for a capability
  the `hosted-api` path already delivers against a local server. Left as a documented follow-up; the
  `LocalOnnxEmbedder` stays a stub and announces itself as one (R3).
- *Default to a hosted cloud embedder (e.g. OpenAI)*: rejected as the default — it sends every
  dataset title/description to a third party (data egress) and adds an API-key dependency to a tool
  whose whole point is a local, auditable mirror. The `hosted-api` provider *can* point at such a
  service if an operator chooses, but the recommended production path is a local server.

---

## R2 — `dimension` is explicit config, not auto-detected

**Decision**: `EmbedderConfigSchema` gains an optional `dimension` (`z.number().int().min(1).max(8192)`,
nullable/optional; unset → the provider default — `32` for the `local-onnx` stub, `384` for
`hosted-api`). It is recorded in `embeddings_meta(model_id, dimension)`, and `run-index.ts` treats a
change to it exactly like a model change: at run start it compares the stored meta against the live
embedder and re-embeds when **either** `meta.model_id !== embedder.id` **or**
`meta.dimension !== embedder.dimension` (`run-index.ts:213`, then `setEmbeddingsMeta(...)`). The
operator sets `dimension` to match the served model (e.g. `4096` for Qwen3-Embedding-8B).

**Rationale**: Making the dimension an explicit declared value does two jobs. First, it makes the
re-embed **deterministic and offline**: the model-change decision is a comparison against stored
meta, not a network round-trip to discover the model's vector length, so `danni index` knows up
front that the configured embedder differs from what's persisted. Second, it gives
`HostedApiEmbedder` a **contract to validate the API's output against** (R3) — without a declared
expectation there is nothing to check the returned vector length against. The provider defaults
(`32`/`384`, `local-onnx.ts:27`, `hosted-api.ts:32`) keep existing configs valid with no edit.

**Alternatives considered**:
- *Auto-detect the dimension by embedding a probe text at startup*: rejected — it adds a network
  call (and a failure mode) to every index/search/eval run, and it removes the very thing that lets
  the embedder *catch* a misconfigured server (if the code just trusts whatever length comes back,
  a model swap that changes dimension silently degrades search instead of failing fast, R3).
- *Persist nothing and infer re-embed need from `model_id` alone*: rejected — two different models
  could share an `id` string while differing in dimension, and a dimension change with the same id
  is exactly the case that must trigger a full re-embed; storing `dimension` in `embeddings_meta`
  makes that case detectable.

---

## R3 — `HostedApiEmbedder` validates returned vector length == configured dimension and throws

**Decision**: After a successful embeddings response, `HostedApiEmbedder.embed()` checks the length
of the first returned vector against the configured `dimension` and throws on mismatch
(`hosted-api.ts:56–61`): `Embedder returned ${got}-dim vectors but enrichment.embedder.dimension is
${this.dimension}; set dimension to ${got} to match the model`. (It also already asserts the
response returned one vector per input text.) The check fires at index time, before any vector is
persisted.

**Rationale**: `cosine()` returns `0` for vectors of differing length, so a wrong `dimension` config
would not error — it would quietly score every semantic comparison as zero similarity, collapsing
the hybrid search to keyword-only **with no signal that anything is wrong**. That is the worst
failure mode: search keeps "working" but the whole point of this feature (semantic + cross-lingual
recall) is silently off. Failing loudly at the embedder boundary, with a message that names the
actual returned dimension and tells the operator what to set, converts a silent quality regression
into a fast, self-explanatory startup failure (US4). The declared `dimension` (R2) is the contract;
this is what enforces it.

**Alternatives considered**:
- *Warn and continue on mismatch*: rejected — a warning on stderr would scroll past during a long
  re-index and the run would still persist meaningless-distance vectors; the operator would discover
  the degradation only later via poor recall. Fast failure is correct for a config error.
- *Pad/truncate the vector to the configured dimension*: rejected — silently reshaping a model's
  output produces vectors whose geometry is meaningless; it hides the misconfiguration rather than
  surfacing it.

---

## R4 — A backend-agnostic recall harness that doubles as the embedder-swap validator

**Decision**: `evaluateRecall(opts)` (`src/index/eval.ts`) runs each labelled query through the
**real hybrid `search()`** and scores **recall@K**. A query is a *hit* when any id in its `expected`
array appears in the top-K (`limit`, default `5` — the SC-004 "top 5"). It returns a `RecallReport`:
`{ limit, total, hits, recallAtK, byLang: { bg, en: { total, hits, recall } }, misses: [{ query,
lang, expected, got }] }`. It takes the `Embedder` as an argument and embeds nothing itself — it
measures whatever embedder is wired.

**Rationale**: Because the harness drives the *same* `search()` the CLI uses, with whatever embedder
is configured, it is simultaneously the SC-004 instrument **and** the validation tool for the stub→
real swap: the identical query set scored against the stub vs against a real model is exactly the
before/after that proves the swap worked. Splitting recall **by language** (`byLang.bg` / `byLang.en`)
exposes the cross-lingual axis (FR-014 of spec 001) — an English query against a Cyrillic corpus is
the case a stub or a monolingual model fails — and surfacing the **misses** (`expected` vs `got`)
makes a sub-target run diagnosable rather than just a number. `recallAtK` is the SC-004 metric.

**Alternatives considered**:
- *Score against a separate "semantic-only" path bypassing FTS*: rejected — the product is the
  fused hybrid result; measuring something other than what users get would not validate SC-004.
  Cross-lingual hits are still attributable to the vector leg because an English query has zero FTS
  overlap with a Cyrillic title (so those hits are pure `matchKind='semantic'`, SC-004 below).
- *Report only an overall number*: rejected — the overall figure can hide a collapsed BG or EN side;
  the language split is the whole point of the cross-lingual requirement, and the misses are needed
  to tune `RRF_K`/`--limit` against real failures.

---

## R5 — CI smoke uses the stub + a committed fixture corpus (floor ≥0.75); the 0.90 number is operational

**Decision**: The eval CI smoke (`tests/integration/eval-smoke.test.ts`) runs `evaluateRecall` over
the shipped query set (`tests/fixtures/search/query-set.json`) against the **shared bilingual fixture
corpus** (`tests/fixtures/search/cross-lang-corpus.ts`, seeded then indexed) with the **deterministic
stub embedder** (`new LocalOnnxEmbedder({ dimension: 32 })`). It asserts `recallAtK >= 0.75` (the CI
floor, mirroring `search-cross-lang`) plus a non-empty BG and EN split, and stays green **offline**.
The real **recall@5 ≥ 0.90 (SC-004)** is an *operational* number — it requires a real multilingual
embedder against the real mirror — and is recorded in `docs/semantic-search.md`. The committed
`tests/fixtures/search/live-query-set.example.json` is a real-id template (38 queries: 30 BG + 8
English cross-lingual) captured from a 100-dataset live run, so an operator can copy its shape.

**Rationale**: A CI gate must be deterministic, offline, and fast — it cannot stand up a 4096-dim
model. The stub + a tiny committed corpus gives exactly that: it proves the harness, the CLI, the
language split, and the miss-reporting all *work* every commit, at a floor (≥0.75) the stub can clear
on the fixture, without pretending to measure semantic quality. The genuine 0.90 is a property of a
real model on real data, so it lives where operational results belong (the docs), and the live query
set is shipped as an *example* (real ids, real titles) rather than as a CI asset so the procedure is
reproducible without coupling CI to a private mirror. The fixture corpus is **shared** with
`search-cross-lang` so the query set and the corpus it is written against never drift apart.

**Alternatives considered**:
- *Gate CI on 0.90 with a real embedder in the pipeline*: rejected — non-deterministic, slow, and
  it would couple CI to an external model server and a private corpus. SC-004 is validated
  operationally and gated on demand via `danni eval --min-recall 0.9`.
- *Skip the offline smoke entirely and only ever measure live*: rejected — then the harness, CLI
  flags, and report shape would have no automated coverage at all; the smoke locks those down even
  though the *number* it asserts is only a floor.

---

## R6 — Warn at the CLI boundary, not in the `LocalOnnxEmbedder` constructor

**Decision**: The stub warning lives in the shared `buildEmbedder()` factory
(`src/index/embedders/factory.ts`), which `danni index`, `danni search`, and `danni eval` all call.
`LocalOnnxEmbedder` exposes a read-only `isStub` boolean — `true` exactly when no real `embedFn` was
injected (`local-onnx.ts:28`). After constructing the embedder, the factory checks `embedder.isStub`
and, when true, writes **one** `warning:` line to **stderr** naming the stub model id
(`embedder.id`, e.g. `local-onnx:hash-stub-32`) and stating that semantic ranking is not meaningful
and only the FTS/keyword leg is real. The constructor never warns; an injected real `embedFn` sets
`isStub = false`, so the warning never fires for tests or a real model.

**Rationale**: Many tests legitimately construct the stub with the deterministic hash (e.g. `new
LocalOnnxEmbedder({ dimension: 32 })` in the eval smoke); warning in the constructor would spam those
suites and, worse, *mislead* — a fixture using the stub is not a misconfiguration. Exposing the state
as `isStub` and letting the **operator-facing factory** decide to warn keeps the policy where the
human-driven invocation is (FR-006). Stderr is the channel because stdout carries machine-readable
output — `danni index`'s result JSON, `danni search --json`, `danni eval --json` — and the advisory
must not corrupt it. Centralizing the warning in the one factory all three commands share also means
the three can never drift on *whether* they warn (the same reason the factory exists, R-factory).

**Alternatives considered**:
- *Warn in the `LocalOnnxEmbedder` constructor*: rejected — fires for every test that constructs the
  stub, conflating "test fixture" with "production misconfiguration", and would need a suppression
  flag that just re-creates this boundary decision one layer deeper. (This is the same call made for
  005's stub warning, now consolidated into the shared factory.)
- *Warn from inside `search()` / `runIndex()`*: rejected — those are library functions also called
  by tests and by injected real `embedFn`; the warning belongs at the process boundary that owns
  stderr and knows it is a human-driven CLI run.
- *Put the stub model id on the result (stdout / a result field)*: rejected — the index-entry schema
  is closed and unchanged (R7), and a once-per-invocation operator advisory does not belong on a
  per-result field or on the JSON channel.

---

## R7 — No new migration and no new external contract

**Decision**: The feature ships **no** migration and **no** `contracts/` directory. The new
`dimension` is additive *config* on `EmbedderConfigSchema`; the column it feeds,
`embeddings_meta(model_id, dimension)`, already exists, so there is nothing to migrate. The recall
report (`RecallReport` in `src/index/eval.ts`) is an **internal** TypeScript shape, not a published
JSON-Schema contract — its only consumer is `danni eval`'s own output. Search results returned by
the harness still flow through the existing, unchanged `contracts/index-entry.schema.json`. The
`danni eval` query-set input is validated by an inline **zod** schema in `src/cli/eval.ts`
(`{ queries: [{ query, lang: 'bg'|'en', expected: string[≥1], rationale? }] }`), not a new external
contract file.

**Rationale**: Every persisted-schema element this feature needs was already there from 002 (the
`embeddings_meta` columns, the model-change re-embed path); the work is *wiring* a real backend
through config plus adding a measurement instrument. The eval output is consumed only by the eval
command itself, so promoting it to a published contract would add a versioned external surface for no
external consumer. This mirrors 002, 003, and 005, which also shipped without a `contracts/`
directory — noted explicitly so a reader does not expect one. The `migrate-smoke` gate stays green
precisely because no migration was added.

**Alternatives considered**:
- *Add a migration to persist the dimension separately or to record recall results*: rejected — the
  dimension already has its column in `embeddings_meta`, and recall is a *measurement* an operator
  runs on demand, not durable pipeline state to store.
- *Publish a `recall-report.schema.json` external contract*: rejected — the report has exactly one
  consumer (the `danni eval` printer / `--json` emitter); a published contract is overhead for an
  internal shape. The query-set *input* is guarded by zod at the CLI boundary, which is the right
  place to reject a malformed file (exit 2).
