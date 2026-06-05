# Quickstart — Real Multilingual Embedder + Recall Evaluation (006)

> **Audience**: an operator (or reviewer) verifying that the vector leg of search
> can be swapped from the deterministic hash stub to a real multilingual embedder
> via config alone, that retrieval quality is measurable as recall@K (the SC-004
> instrument), and that the stub is never silently presented as a real embedder.
> This is a RETROFIT of already-shipped work (**Status: Implemented**, 2026-06-05,
> commits `b11398e` + `d75007f`); the steps below confirm the shipped behavior, not
> new behavior to enable. No new migration; no new external contract (the eval
> report is an internal shape, search results reuse `index-entry.schema.json`).

All commands run from the repo root with Bun installed.

## 0. Green gate (run this first and last)

The whole feature was added under a green suite. Confirm the three gates pass
before and after exercising the individual pieces:

```bash
bun test          # expect: full suite green, 0 fail (incl. the new eval + factory suites)
bun run lint      # biome check . — expect: clean
bun run typecheck # tsc --noEmit — expect: clean
```

`bun test` also runs the constitution gates (parity-matrix + migrate-smoke); they
stay green because this feature consumes no new endpoint and ships no migration —
`dimension` is additive config and the eval report is internal.

## 1. Verify the shared embedder factory (FR-002 · US1)

A single `buildEmbedder(config.enrichment.embedder)` factory selects
`HostedApiEmbedder` vs `LocalOnnxEmbedder` and is the one import used by `danni
index`, `danni search`, `danni eval`, AND `danni mcp` — so the four never drift on
provider selection. It threads `dimension` + `maxBatchSize` and emits the stub
warning at the CLI boundary.

```bash
bun test tests/unit/index/embedders/factory.test.ts
# expect: green — provider='hosted-api' (with endpointUrl) builds a HostedApiEmbedder
#   threading dimension + maxBatchSize; missing endpointUrl throws; provider='local-onnx'
#   builds the stub and the factory writes exactly one stub warning to stderr.
```

**Acceptance check (FR-002)**: the four entry points
(`src/cli/index-cmd.ts`, `src/cli/search.ts`, `src/cli/eval.ts`, `src/cli/mcp.ts`)
all resolve their embedder through `src/index/embedders/factory.ts`, never by
constructing `HostedApiEmbedder` / `LocalOnnxEmbedder` directly.

## 2. Verify the recall harness (FR-004 · US2)

`evaluateRecall` (`src/index/eval.ts`) runs each labelled query through the real
hybrid `search()` and scores recall@K overall, split by language `{bg,en}`, plus
the misses (expected vs retrieved). It is backend-agnostic — it measures whatever
embedder is wired — so it doubles as the validation instrument for the swap.

```bash
bun test tests/unit/index/eval.test.ts
# expect: green — recallAtK = hits/total; byLang split sums to total; a query is a
#   hit when ANY id in its `expected` appears in the top-K; misses carry { query,
#   lang, expected, got }.
```

**Acceptance check (FR-004)**: `RecallReport` is
`{ limit, total, hits, recallAtK, byLang:{bg,en:{total,hits,recall}}, misses:[…] }`
and a hit is satisfied by any expected id within the top-K `limit`.

## 3. Verify the `danni eval` CLI (FR-005 · US2)

The CLI zod-validates the query set, computes recall through the harness, and gates
on `--min-recall`. Exit codes: `0` ok · `2` bad flag or invalid/missing query-set ·
`3` recall@K below the floor (the eval ran fine but did not meet the target).

```bash
bun test tests/unit/cli/eval.test.ts
# expect: green — parseFlags enforces --query-set required, --limit 1..50 (default 5),
#   --min-recall 0..1; run() returns 2 on a bad flag / unreadable / schema-invalid
#   query-set and 3 when recall@K < --min-recall.
```

Exercise it against the committed fixture set (offline, stub embedder — the warning
from step 5 will also fire):

```bash
bun run src/cli/danni.ts eval --query-set tests/fixtures/search/query-set.json
# expect: a one-line summary, e.g.:
#   recall@5: NN.N% (h/20)  embedder=local-onnx:hash-stub-32
#     bg: NN.N% (…)  en: NN.N% (…)
# plus a misses block if any query missed.

bun run src/cli/danni.ts eval --query-set tests/fixtures/search/query-set.json --json
# expect: the full RecallReport as JSON on stdout.
```

**Acceptance check (FR-005)**: `--min-recall 0.9` on a query set that scores below
0.9 returns exit 3; a malformed `--limit` (e.g. `0` or `99`) returns exit 2.

## 4. Verify the dimension-mismatch guard (FR-003 · US4)

`HostedApiEmbedder.embed()` validates that the returned vector length equals the
configured `dimension` and throws on mismatch — otherwise `cosine()` returns 0 for
length-mismatched vectors and search silently degrades to keyword-only. The
declared dimension is the contract.

```bash
bun test tests/unit/index/embedders/hosted-api.test.ts
# expect: green — a response whose embedding length != configured dimension throws
#   ("returned <got>-dim vectors but … dimension is <n>"); a matching length passes;
#   a wrong `data.length` (count != input count) also throws.
```

**Acceptance check (FR-003)**: a `dimension` that disagrees with the model's actual
output makes `danni index` fail fast rather than degrade search silently.

## 5. Observe the no-silent-stub warning (FR-006 · US3)

When the embedder resolves to the deterministic `local-onnx` hash stub (no injected
`embedFn`), the factory prints exactly one stderr warning naming the stub model id
`local-onnx:hash-stub-32`. The warning lives at the CLI boundary (`buildEmbedder`),
reading `LocalOnnxEmbedder.isStub` — it does NOT fire from the embedder constructor,
so the suites that construct the stub legitimately stay quiet, and a real injected
`embedFn` / `hosted-api` provider stays quiet too.

```bash
bun run src/cli/danni.ts eval --query-set tests/fixtures/search/query-set.json 2>warn.txt
grep -c 'local-onnx:hash-stub-32' warn.txt
# expect: 1

bun run src/cli/danni.ts search "набор" 2>warn.txt
grep -c 'local-onnx:hash-stub-32' warn.txt
# expect: 1 (one per invocation; switching enrichment.embedder.provider to
#   'hosted-api' with an endpointUrl emits no stub warning)
```

**Acceptance check (FR-006)**: each `danni eval` / `danni index` / `danni search`
invocation on the default local-onnx config prints exactly one stub warning naming
`local-onnx:hash-stub-32`; a real embedder is silent.

## 6. Verify the eval CI smoke (SC-002)

`tests/integration/eval-smoke.test.ts` runs `evaluateRecall` over the shipped
query set against the committed cross-lang corpus fixture with the stub embedder —
fully offline. It asserts the query set is well-formed (every `expected` id exists
in the corpus) and that recall stays at or above the CI floor of `0.75`, with a
non-zero BG and EN split.

```bash
bun test tests/integration/eval-smoke.test.ts
# expect: 2 pass — query set well-formed; recall@5 ≥0.75 with byLang.bg.hits>0 and
#   byLang.en.hits>0
```

**Acceptance check (SC-002)**: the smoke is green offline with the stub at ≥0.75.
The real `0.90` number is operational (a real embedder + the real mirror), not a CI
assertion — recorded in `docs/semantic-search.md`.

## 7. Switch the stub for a real embedder + re-index (SC-001 · US1)

Point `enrichment.embedder` at a real OpenAI-compatible endpoint in
`danni.config.json` — a hosted API or a local server (text-embeddings-inference,
Ollama, vLLM, LM Studio) — set `dimension` to the model's actual output length, and
re-index. Because `dimension` (and the embedder id) are recorded in
`embeddings_meta`, a change drives `run-index`'s **model-change path**: every active
dataset is re-embedded; the FTS rows are model-independent and are not rebuilt.

```jsonc
// danni.config.json — local OpenAI-compatible server example
"enrichment": {
  "embedder": {
    "provider": "hosted-api",
    "endpointUrl": "http://spark:PORT/v1/embeddings",  // full /embeddings path
    "modelId": "Qwen3-Embedding-8B",                   // the served model name
    "dimension": 4096,                                 // MUST match the model output
    "batchSize": 32,
    "maxBatchSize": null                               // server's hard cap if any
  }
}
```

```bash
# confirm the served model id and output dimension BEFORE indexing (see docs/semantic-search.md):
curl -s http://spark:PORT/v1/models
curl -s -X POST http://spark:PORT/v1/embeddings -H 'content-type: application/json' \
  -d '{"input":["проба"],"model":"Qwen3-Embedding-8B"}' \
  | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"][0]["embedding"]))'

bun run src/cli/danni.ts index    # model-change path: re-embeds every active dataset
```

**Acceptance check (SC-001)**: switching `provider` stub→real + `danni index`
re-embeds every active dataset via the model-change path (no stub warning now).
Verified live: 100 datasets re-embedded in 4 batches, ~2s.

## 8. Live recall procedure (SC-003, SC-004 · cross-lingual)

For a meaningful number, evaluate the real embedder against a query set whose
`expected` are **real captured dataset ids** (from `danni search` / `danni
mirror-info`), balanced BG/EN. `tests/fixtures/search/live-query-set.example.json`
is a committed real-id template (38 queries — 30 BG + 8 English cross-lingual,
generated from a 100-dataset live capture).

```bash
# after section 7's re-index, gate on SC-004:
bun run src/cli/danni.ts eval --query-set ./live-query-set.json --min-recall 0.9
# expect: exit 0 with recall@5 ≥0.90; the bg/en split shows the cross-lingual axis,
#   any misses are listed for tuning.
```

A `danni mcp` consumer reads through the same wired embedder
(`buildEmbedder(config.enrichment.embedder)` in `src/cli/mcp.ts`), so once the swap
+ re-index is done, `mirror_search` over MCP returns the same semantically-ranked
hits the eval validates — confirm by issuing a `mirror_search` JSON-RPC call and
checking the returned hits' `matchKind`.

**Acceptance check (SC-003/SC-004)**: against vLLM serving Qwen3-Embedding-8B
(4096-dim) on the real mirror, recall@5 = 100% (38/38), including 8/8 English→Bulgarian.
The English queries have zero FTS overlap with the Cyrillic titles, so those hits
are pure vector — confirmed `matchKind='semantic'`.

## Success-criteria checklist (from spec §Success Criteria)

- **SC-001**: step 7 — `provider` stub→real + `danni index` re-embeds every active
  dataset via the model-change path (live: 100 datasets, 4 batches, ~2s).
- **SC-002**: step 6 — `tests/integration/eval-smoke.test.ts` runs `evaluateRecall`
  over the shipped query set with the stub and stays ≥0.75, green offline.
- **SC-003**: step 8 — against a real multilingual embedder on the real mirror,
  recall@5 ≥0.90 (live: Qwen3-Embedding-8B 4096-dim → 100%, 38/38).
- **SC-004**: step 8 — cross-lingual recall works via the semantic vector path; an
  English query with zero FTS overlap with a Cyrillic title is a pure-vector hit
  (`matchKind='semantic'`); live: 8/8 English→Bulgarian.
