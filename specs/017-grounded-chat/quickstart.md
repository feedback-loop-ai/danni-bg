# Quickstart: Trustworthy grounded chat

**Feature**: 017-grounded-chat · **Status**: Implemented

This walks through configuring the chat provider and exercising the four grounding behaviours.

## 1. Configure the default LLM provider (setup, PR #22)

The chat (`/api/chat`) returns *"no server default provider is configured"* until a default LLM is set. Copy the committed example and fill it in — Bun auto-loads a repo-root `.env` for `bun run`:

```bash
cp .env.example .env
```

`.env.example` documents `EXPLORER_DEFAULT_*`:

```bash
# Self-hosted vLLM (openai-compatible), started with
#   --enable-auto-tool-choice --tool-call-parser ...
EXPLORER_DEFAULT_PROVIDER=openai-compatible
EXPLORER_DEFAULT_MODEL=gemma-4-26b-uncensored
EXPLORER_DEFAULT_BASE_URL=http://spark:8000/v1
EXPLORER_DEFAULT_API_KEY=EMPTY

# Or Anthropic:
# EXPLORER_DEFAULT_PROVIDER=anthropic
# EXPLORER_DEFAULT_MODEL=claude-sonnet-4-6
# EXPLORER_DEFAULT_API_KEY=sk-ant-...
```

Notes:
- **The endpoint MUST support tool/function calling** — the chat agent uses the four mirror tools. A vLLM must be started with `--enable-auto-tool-choice`. A non-tool endpoint still works via the retrieval (RAG) fallback (which also injects focused rows).
- `.env` and `.env.local` are **gitignored** — real config/secrets are never committed.
- User-supplied credentials are sent per request and never persisted or logged server-side (FR-024). The server-default key lives only in this server config.
- Run the explorer API unsandboxed if your provider/embedder is on the LAN.

## 2. Ask about a focused dataset — grounded, no fabrication (US1)

"Ask about this dataset" sends the dataset as a hard focus (`scope.datasetIds`):

```bash
curl -N http://localhost:PORT/api/chat -H 'content-type: application/json' -d '{
  "message": "какво съдържа този набор?",
  "scope": { "datasetIds": ["<sports-club-register-id>"] },
  "provider": { "kind": "openai-compatible", "model": "gemma-4-26b-uncensored", "useServerDefault": true }
}'
```

Expected: the answer lists the **real** rows (e.g. the 10 distinct sports clubs with their real ЕИКs, and notes the empty rows) — never invented names/codes — and the SSE `citations` event cites the focused dataset, even if the model called no tools.

## 3. Grounding follows the conversation (US2)

Start unfocused and follow up:

```
turn 1 (no scope): "дай ми всички спортни клубове в Ихтиман"
turn 2 (same sessionId, no scope): "какви спортове има?"
```

Pass the `sessionId` from the first turn's `session` SSE event back on the second request. Expected: turn 2 answers from the **same** clubs' rows (re-injected from the session's sticky context) and still cites that dataset — it does not ask "which dataset?". Long conversations are safe: only the most recent ~10 messages / 24k chars of transcript are replayed; the grounding rows live in the system prompt.

## 4. Auto-focus the open reader (US3)

Open a dataset in the document reader, then ask a row-/район-level question. The web client (`ChatPanel.tsx`) automatically adds the open reader's id as `groundingDatasetIds`:

```bash
curl -N http://localhost:PORT/api/chat -H 'content-type: application/json' -d '{
  "message": "детски градини в район Панчарево",
  "groundingDatasetIds": ["<sofia-schools-kindergartens-id>"],
  "provider": { "useServerDefault": true, "kind": "openai-compatible", "model": "gemma-4-26b-uncensored" }
}'
```

Expected: instead of "no data", the answer lists real район Панчарево kindergartens. Панчарево is a sub-municipal район that exists only as a row *value* and is not indexed, so blind search can't reach it — grounding (injecting up to 1000 rows, bounded at 90k chars) can. Grounding does **not** narrow tool scope, so the model can still search beyond this dataset.

## 5. Exact value-filter on a column (US4)

For an exhaustive question, the model can target a column at the data layer. The focus block lists the resource's exact column names (`Колони: …`) and `resourceId`; the model calls:

```jsonc
// readResource tool call
{ "datasetId": "<id>", "resourceId": "<rid>", "filters": { "rayon": "Панчарево" } }
```

Expected: ONLY rows whose `rayon` column contains "Панчарево" (case-insensitive), scanned across the whole resource (up to the grid cap) — exact, complete, and independent of the injection budget (so it works on datasets too big to inject).

## Caveat

Grounding is robust by construction (the answer is grounded and the dataset cited regardless of whether the model calls a tool). But `gemma-4-26b-uncensored` is tool-shy: it sometimes enumerates an injected sample **incompletely** and does **not reliably call** the value-filter. The data is fully available to it either way and the answer is never fabricated; **exact/exhaustive completeness depends on a more faithful tool-calling model** (swap via the `.env` provider config in step 1).
