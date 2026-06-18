# Data Model: Agentic quality evals + grounding transparency

No persistent storage, no migration. These are in-memory / on-the-wire structures.

## ChatTurnResult.groundingText (new, server-side)

The exact grounding context injected into the model for a turn — surfaced for observability/evals, emitted to clients only on `debug:true`.

- Type: `string | undefined` (optional; `exactOptionalPropertyTypes`).
- **No-tools / focus path** (`runRagTurn`, focused datasets): the "ДАННИ (ground truth)" / RAG row block produced by `buildFocusContext` — per dataset: title + id; per resource: total/shown counts, partial flag, exact column names, `resourceId`, and the sampled rows.
- **Tool-loop path** (`runToolLoop`): the captured `tool-result` payloads the model received (`Резултат от <tool>: <json>`), optionally prefixed by a focus block.
- Bounded by `GROUNDING_TOTAL_CHARS` (90,000) — tool-result capture stops accumulating past the budget.

## Chat request delta (on `chatRequestSchema`)

- `debug?: boolean` — when true, the route emits a `grounding` SSE event carrying `groundingText`. Absent/false → unchanged response (no `grounding` event). Zod-validated, `.strict()`.

## Eval: Case (`eval/agentic/cases.py`)

```
Case {
  id: str
  kind: "grounded" | "nodata" | "fabrication" | "antifab"
  question: str
  expect_tool: str | None          # soft tool-correctness expectation
  known_model_fabrication: bool    # on-failure xfail (grounding correct, model still fabricates)
}
```

## Eval: ChatResult (`eval/agentic/chat_client.py`)

Parsed from the SSE stream of one real chat turn:

```
ChatResult {
  text: str                # concatenated token deltas
  tools_called: list[str]  # from `tool` events (status=="start")
  citations: list[dict]    # from the `citations` event (datasetId, titleBg, sourceUrl, freshness)
  grounding_text: str|None # from the `grounding` event (debug)
  session_id: str|None
  error: dict|None         # from an `error` event
}
```

## Eval: ProviderCfg (`eval/agentic/config.py`)

```
ProviderCfg { kind, model, base_url, api_key }
```

- **subject** ← `EVAL_SUBJECT_*` else `EXPLORER_DEFAULT_*` (sent explicitly in each chat request).
- **judge** ← `EVAL_JUDGE_*` else `EXPLORER_DEFAULT_*` (independently repointable; pinned to LAN gemma when the default is DeepSeek).
- Resolution order per value: `eval/agentic/.env` > repo-root `.env` > built-in default. Secrets from env only.

## Eval: metric set (`eval/agentic/metrics.py`)

- **Faithfulness** (G-Eval, judge): claims traceable to the retrieval context; fabrication = hard fail; honest no-data = faithful. `evaluation_params=[INPUT, ACTUAL_OUTPUT, RETRIEVAL_CONTEXT]`, threshold 0.7.
- **RefusalQuality** (G-Eval, judge): honest "no relevant data" vs improvisation. `[INPUT, ACTUAL_OUTPUT]`, threshold 0.8.
- **ToolCorrectness** (deterministic): called vs expected tools; no LLM for the score (judge passed only to satisfy construction; reason disabled).
- Both G-Eval metrics use explicit `evaluation_steps` (skip the generate-the-steps round-trip) and `async_mode=False` (avoid the pytest event-loop fallback to a default OpenAI model).

## Constants (chat, run.ts)

- `RAG_GROUNDING_DATASETS = 3` — top retrieved candidates row-injected on the RAG path.
- `RAG_GROUNDING_HEADER` — Cyrillic header for the RAG grounding block (no `readResource` hint; forbids inventing values; instructs no-data when the sample lacks the answer).
- Reused from 017: `GROUNDING_TOTAL_CHARS = 90_000`, `FOCUS_ROWS = 1000`, `buildFocusContext`.

## Eval reconstruction bounds (`eval/agentic/test_agentic.py`)

- `_MAX_CONTEXT_DATASETS = 8`, `_ROWS_PER_DATASET = 200`, `_ROWS_CHARS_CAP = 8000` — only used when no `grounding` event is available (fallback), to keep the judge prompt bounded.
