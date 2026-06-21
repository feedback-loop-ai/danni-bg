# Requirements checklist

Retrospective verification for spec 025 (all items met on `main`, PR #73 / `8b9b26b`).

## Functional

- [x] FR-109 — Chat answers reference datasets by Bulgarian title; no ids/UUIDs/`datasetId` columns in
  the prose. Enforced via the shared `SYSTEM_PROMPT` (covers tool-loop + RAG); identifiers stay for
  tool calls; the `citations` event still carries id + source URL. *(PR #73)*

## Success criteria

- [x] SC-011 — Live answers: 0 UUIDs / no `datasetId` column, citations still emitted —
  `deepseek-v4-pro`: "качество на въздуха" 51 citations / 0 UUIDs; "регистри" (geo-scoped) 144
  citations / 0 UUIDs.

## Quality gates

- [x] `tsc` + `biome` clean (string-constant change).
- [x] No schema/state change; `citations` SSE event unchanged.
- [x] Backward-compatible (same SSE events; only the answer prose is cleaner).

## Out of scope

- [ ] Citation-list volume / de-duplication — separate UX concern, not addressed here.
