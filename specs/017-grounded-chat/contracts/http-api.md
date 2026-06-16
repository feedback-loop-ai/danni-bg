# Contract: `/api/chat` request & SSE (grounded-chat delta)

**Feature**: 017-grounded-chat · **Service**: `apps/explorer-api` (Bun + Hono)

This is a **delta** over `specs/008-map-data-explorer/contracts/http-api.md` (the base `POST /api/chat` contract). It adds the `groundingDatasetIds` request field and clarifies the grounding guarantees. Contract-first per Constitution III; the request is Zod-validated (`.strict()`, Constitution VII); secrets are never logged (FR-024). The endpoint keeps its existing `tests/parity-matrix.json` row.

---

## POST /api/chat  (Server-Sent Events)

Backend-mediated, grounded, streaming chat. The browser never calls the LLM provider or mirror tools directly (FR-016).

**Request body** (Zod-validated, `.strict()`):
```jsonc
{
  "sessionId": "string|null",         // null → server creates one (session-only, in-memory; FR-019)
  "message": "string",                // min length 1
  "scope": { /* ScopeDescriptor — see chat-tools.md; scope.datasetIds is a HARD focus */ },
  "groundingDatasetIds": ["string"],  // NEW (optional): datasets to ground the turn in (rows injected
                                      //   as context) WITHOUT narrowing tool scope — e.g. the dataset
                                      //   currently open in the reader. Distinct from scope.datasetIds.
  "provider": {                       // per-request; never persisted/logged (FR-024)
    "kind": "openai-compatible | anthropic",
    "baseUrl": "string|null",
    "model": "string",
    "apiKey": "string|null",
    "useServerDefault": false         // true → use the EXPLORER_DEFAULT_* server config
  }
}
```

**Grounding precedence** (row injection only — NEVER narrows tool scope):
1. `scope.datasetIds` (explicit hard focus) — also narrows tool scope.
2. `groundingDatasetIds` (reader focus) — injection only.
3. the session's sticky `contextDatasetIds` (what the conversation was already "about").

The chosen set's rows are pre-read (up to 1000 rows/resource, bounded at 90,000 chars total) and injected as a "ДАННИ (ground truth)" block. After the turn, the same precedence decides the next turn's sticky context (`scope.datasetIds` → `groundingDatasetIds` → the answer's citations), deduped and capped at 2.

**Response**: `text/event-stream`. Event types (unchanged from 008):
| event | data |
|-------|------|
| `session` | `{ "sessionId": "..." }` (first event) |
| `token` | `{ "delta": "..." }` streamed answer text |
| `tool` | `{ "name": "mirrorSearch\|mirrorEntitySearch\|mirrorInfo\|readResource", "status": "start\|done" }` (observability; no raw secrets) |
| `citations` | `{ "citations": Citation[] }` — each validated to exist in the mirror (SC-001) and within scope (SC-007) |
| `anchors` | `{ "geoEntityIds": [], "datasetIds": [] }` — map highlight/focus (FR-026/FR-027) |
| `done` | `{}` |
| `error` | `{ "code": "...", "message": "..." }` (e.g. `provider_unconfigured`, `provider_error`) |

**Grounding guarantees** (contract-tested — delta highlighted):
- A grounded (focused/reader/sticky) dataset whose rows were injected is **always cited**, even when the model calls no tools (FR-034).
- Every specific value stated in the answer appears verbatim in a tool result or the injected context; the system prompt forbids stating any value not present verbatim and forbids fabricating to agree with the user (FR-016, FR-035, SC-001).
- `groundingDatasetIds` injects rows but does **not** restrict what the tools may read — the model can still search/read datasets outside that id (FR-036).
- When grounding and tools yield nothing relevant, the stream yields an explicit "no relevant public data found" answer, not a fabrication (FR-018).
- The transcript is replayed only within a bounded recent window (≤ 10 messages / 24,000 chars); grounding rows live in the system prompt, so trimming old turns never drops grounding (FR-040).
- Provider misconfig/failure → `error` event with a clear code; no fabricated answer (FR-023).

**Validation errors**: a body failing `chatRequestSchema` (e.g. unknown field — schema is `.strict()` — or `message` empty) → HTTP 400 `{ "error": { "code": "bad_request", ... } }`.

---

## Parity matrix obligations

`/api/chat` keeps its existing parity-matrix row; the `groundingDatasetIds` field and the always-cite-grounded guarantee are covered by `apps/explorer-api/tests/chat-route.test.ts` ("groundingDatasetIds grounds + cites without a hard scope focus", sticky-grounding follow-up) and `chat-focus.test.ts`.
