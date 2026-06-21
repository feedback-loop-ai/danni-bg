# Tasks: Chat answer presentation — no raw dataset GUIDs

Retrospective task list (all complete). Single phase; shipped in PR #73 (`8b9b26b`).

## Phase 1 — Drop GUID noise from answers

- [x] T001 Add a clause to the shared `SYSTEM_PROMPT` (`apps/explorer-api/src/chat/grounding.ts`):
  reference datasets by Bulgarian title; never print dataset ids / UUIDs / technical identifiers in
  the answer; identifiers are for tool calls only. Covers both the tool-loop and RAG paths (both build
  on `SYSTEM_PROMPT`). — FR-109
- [x] T002 Verify live (`deepseek-v4-pro`): "качество на въздуха" → 51 citations / 0 UUIDs / no
  `datasetId` column; "регистри" (geo-scoped) → 144 citations / 0 UUIDs. Citations/links unaffected.
  `tsc` + `biome` clean. — SC-011

## Notes
- No schema/state change; the `citations` SSE event still carries each dataset's id + source URL.
- Out of scope: citation-list volume/dedup (separate UX concern).
