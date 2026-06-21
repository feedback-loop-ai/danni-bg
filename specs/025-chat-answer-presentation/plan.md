# Implementation Plan: Chat answer presentation — no raw dataset GUIDs

**Spec**: [spec.md](./spec.md) · **Status**: Implemented (retrospective for PR #73, commit `8b9b26b`).
Stack unchanged: Bun + TypeScript, Hono API, the grounded-chat pipeline (spec 017).

## Architecture

A single prompt clause; no new code paths, state, or schema.

- The chat has two answer paths in `apps/explorer-api/src/chat/run.ts`: the **tool-loop**
  (`runToolLoop`, model calls the grounding tools) and the **RAG fallback** (`runRagTurn`, backend
  retrieves and injects context for non-tool-calling models). Both build their system prompt from the
  shared `SYSTEM_PROMPT` in `apps/explorer-api/src/chat/grounding.ts` (the RAG path appends its own
  context instructions on top).
- The fix adds a clause to `SYSTEM_PROMPT`: refer to each dataset by its **Bulgarian title** in prose,
  and never print dataset ids / UUIDs / technical identifiers (no `datasetId` columns, no `(id: …)`).
  Identifiers stay available to the model for its tool calls only.
- Because both paths share `SYSTEM_PROMPT`, one edit covers them; nothing else changes.

## Why this shape

- **One source of truth.** The shared constant means the tool-loop and RAG paths can't drift on this
  rule.
- **Links already delivered out-of-band.** The `citations` SSE event carries `datasetId` + `sourceUrl`
  for every cited dataset and the UI links them, so the prose never needed the id — removing it is
  pure signal gain with no information loss.
- **Prompt, not post-processing.** A regex strip of UUIDs would mangle a model-authored table (e.g.
  leave an empty `datasetId` column); instructing the model not to produce them in the first place is
  cleaner and keeps the answer well-formed.

## Testing / verification

- `tsc` + `biome` clean (the change is a string constant).
- Live (`deepseek-v4-pro`) before/after on two prompts — see SC-011: 0 UUIDs / no `datasetId` column
  in answers, citations still emitted (51 and 144).

## Risks / tradeoffs

- Prompt compliance is not a hard guarantee (a model could still emit an id); a frontier model
  complied reliably in verification. If a weaker model regresses, a deterministic post-strip could be
  added — deliberately not done now to avoid mangling model-authored tables.
