# Semantic search: real embeddings & recall evaluation

`danni`'s search is a hybrid of FTS5 (keyword) and vector cosine, fused with Reciprocal Rank
Fusion. The **keyword leg is always real**; the **vector leg is only as good as the configured
embedder**. By default the embedder is a deterministic hash stub (`local-onnx:hash-stub-32`) whose
vectors carry no semantic meaning — `danni index`/`search`/`eval` print a stderr warning when it is
in use. To get genuine semantic + cross-lingual recall (SC-004), wire a real embedder.

## 1. Configure a real embedder

The `hosted-api` provider speaks the OpenAI-compatible embeddings protocol
(`POST { input: string[], model } → { data: [{ embedding: number[] }] }`), so it works against a
hosted API **or** a local inference server (text-embeddings-inference, Ollama's `/v1/embeddings`,
vLLM, LM Studio, an MSI EdgeXpert box, …). A local server keeps the corpus offline with no data
egress, which matches the project's "store is the source of truth" ethos.

```jsonc
// danni.config.json (gitignored) — local OpenAI-compatible server example
{
  "enrichment": {
    "embedder": {
      "provider": "hosted-api",
      "endpointUrl": "http://spark:PORT/v1/embeddings",   // full /embeddings path
      "modelId": "Qwen3-Embedding-8B",                    // the served model name
      "apiKeyEnv": null,                                  // or "SPARK_API_KEY" for bearer auth
      "dimension": 4096,                                  // MUST match the model's output dim
      "batchSize": 32,                                    // texts per request
      "maxBatchSize": null                                // set to the server's hard cap if any
    }
  }
}
```

Confirm the served model id and output dimension before indexing:

```sh
curl -s http://spark:PORT/v1/models                       # → the model id to put in modelId
# dimension: embed one text and read the vector length
curl -s -X POST http://spark:PORT/v1/embeddings \
  -H 'content-type: application/json' \
  -d '{"input":["проба"],"model":"Qwen3-Embedding-8B"}' | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"][0]["embedding"]))'
```

`dimension` is recorded in `embeddings_meta`. **Changing the embedder id or dimension triggers a
full vector re-embed** on the next `danni index` (the model-change path in `run-index.ts`) — FTS
rows are model-independent and are not rebuilt. So the switch from the stub to a real model is a
one-liner + a re-index:

```sh
# after editing danni.config.json to provider=hosted-api:
bun run danni index            # re-embeds every active dataset with the real model
bun run danni search "бюджет на общината"   # now semantically ranked
```

> Cross-lingual recall (FR-014) needs a **multilingual** model (e.g. Qwen3-Embedding, or
> paraphrase-multilingual-MiniLM-L12-v2). An English-only model fails the Bulgarian-side recall.

## 2. Measure recall — `danni eval`

`danni eval` scores **recall@K** (the SC-004 metric: the expected dataset in the top-5 for ≥90% of
a representative query set) against a labelled query set, split by language so the cross-lingual
axis is visible, listing the misses so failures are diagnosable.

```sh
danni eval --query-set ./query-set.json            # recall@5 overall + bg/en split + misses
danni eval --query-set ./query-set.json --min-recall 0.9   # exit 3 if below SC-004 (CI/gating)
danni eval --query-set ./query-set.json --json     # machine-readable report
```

Exit codes: `0` success · `2` bad flag or invalid/missing query-set file · `3` recall@K below
`--min-recall` (the eval ran fine but did not meet the target — useful for CI gating).

Query-set format:

```json
{
  "queries": [
    { "query": "бюджет на общината", "lang": "bg", "expected": ["<dataset_id>"], "rationale": "..." },
    { "query": "municipal budget",   "lang": "en", "expected": ["<dataset_id>"] }
  ]
}
```

A query is a **hit** when any id in its `expected` appears in the top-K (`--limit`, default 5).

- The committed fixture set, `tests/fixtures/search/query-set.json` (20 paired BG/EN queries), uses
  the **fixture corpus ids** and powers the offline CI smoke (`tests/integration/search-cross-lang`).
- For a **live** evaluation against the real mirror, supply a query-set whose `expected` are **real
  captured dataset ids** (from `danni search`/`danni mirror-info`). Aim for ≥50 queries grounded in
  actual data.egov.bg titles, balanced BG/EN, to make the recall@5 number meaningful.

### Live procedure (against a populated mirror)

```sh
# 1. point the embedder at your server (section 1) and re-embed
bun run danni index
# 2. evaluate against a real-id query set, gating on SC-004
bun run danni eval --query-set ./live-query-set.json --min-recall 0.9
```

Tune `RRF_K` (currently fixed at 60 in `query.ts`) and `--limit` against the per-query misses the
report surfaces. At corpus scale the in-process cosine scan becomes the search bottleneck; the
`sqlite-vec` virtual-table path (vendored, currently unused) is the planned upgrade.
