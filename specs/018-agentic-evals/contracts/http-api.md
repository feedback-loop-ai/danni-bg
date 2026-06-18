# Contract delta: `POST /api/chat` — debug grounding transparency

Extends the `/api/chat` contract from features 008/017. Additive and backward-compatible; default clients are unaffected.

## Request (delta)

`chatRequestSchema` (Zod, `.strict()`) gains one optional field:

| Field | Type | Required | Meaning |
|------|------|----------|---------|
| `debug` | `boolean` | optional | When `true`, the response stream includes a `grounding` event carrying the exact context injected into the model this turn. For observability / offline faithfulness evals; normal clients omit it. |

All existing fields are unchanged (`sessionId`, `message`, `scope`, `groundingDatasetIds`, `provider`).

## Response (SSE event delta)

Event types remain those of 008/017 (`session`, `token`, `tool`, `citations`, `anchors`, `done`, `error`), with one **opt-in** addition emitted **only when the request set `debug:true` AND a non-empty grounding context exists**, immediately before `citations`:

| Event | Data | When |
|------|------|------|
| `grounding` | `{ "text": string }` | Only on `debug:true` with non-empty `groundingText`. Carries the focus/RAG row block (no-tools path) or the captured tool results (tool-loop path), bounded by the 90,000-char grounding budget. |

Without `debug` (the default), no `grounding` event is emitted and the stream is byte-for-byte as before.

### Example (debug)

```
event: session
data: {"sessionId":"…"}

event: tool
data: {"name":"mirrorSearch","status":"start"}
…
event: grounding
data: {"text":"Резултат от mirrorSearch: [{…}]\n\n…"}

event: citations
data: {"citations":[{"datasetId":"…","titleBg":"…","sourceUrl":"…","freshness":{…}}]}

event: anchors
data: {"geoEntityIds":[…],"datasetIds":[…]}

event: done
data: {}
```

## Notes

- The `grounding` text is for transparency only; it is the *same* context the model was given, not a re-derivation. It carries no new authoritative data and no secrets.
- The tools themselves (`mirrorSearch`, `mirrorEntitySearch`, `mirrorInfo`, `readResource`) are unchanged by this feature.
