# Feature Specification: Chat answer presentation — signal-to-noise (no raw dataset GUIDs)

**Feature Branch**: `025-chat-answer-presentation`
**Created**: 2026-06-21
**Status**: Implemented (PR #73, commit `8b9b26b` on `main`; verified by live
`POST /api/chat` runs against `deepseek-v4-pro`).
**Input**: User feedback during a UX pass — "the elephant in the room: signal-to-noise in the chat,
we present a lot of guids, these bring no value to the end user. We already have the links, citing the
guids for a human is not actionable intelligence."

## Overview

The grounded chat (spec 017) answers from real tool results, which carry each dataset's `datasetId`
(a UUID). The model echoed those UUIDs straight into the prose — whole `datasetId` columns in
tables, `(id: …)` annotations next to titles — turning answers into walls of identifiers.

For a human reader a UUID is noise, not information: the turn already emits a **`citations`** event
carrying each dataset's id **and** source URL, which the UI renders as links. So the linkable id is
already delivered out-of-band; repeating it in the prose adds nothing actionable and drowns the
signal. This feature stops the chat from printing identifiers in the answer text while keeping the
citations (and therefore the links) intact.

## Clarifications

### Session 2026-06-21

- Q: Where do the GUIDs come from? → A: the grounding tools return `datasetId` in their results, and
  the model surfaces it in the answer (sometimes as an entire `datasetId` table column).
- Q: Why is printing them in prose unnecessary? → A: the `citations` SSE event already carries
  `datasetId` + `sourceUrl` for every cited dataset; the UI links them. The id is for the model's tool
  calls, not the reader.
- Q: Where to enforce it, given two chat paths? → A: in the **shared** `SYSTEM_PROMPT`
  (`apps/explorer-api/src/chat/grounding.ts`), which the tool-loop path uses directly and the RAG
  fallback path extends — so one clause covers both. No code beyond the prompt.

## User Scenarios & Testing *(mandatory)*

One responsibility: **chat answers reference datasets by title, not by raw identifier.**

### User Story 1 — Readable answers (Priority: P2)

A user asks the chat about datasets and reads an answer that names each dataset by its Bulgarian
title, with no UUIDs or `datasetId` columns cluttering the prose. The cited datasets are still
available as links (from the citations the UI renders).

**Acceptance**
1. The answer prose contains no dataset UUIDs and no `datasetId` / `(id: …)` columns or annotations.
2. The model still references datasets (by their Bulgarian title) and the `citations` event is still
   emitted, so the UI's links/anchors are unaffected.
3. The behavior holds on both chat paths (tool-loop and RAG fallback).

### Edge Cases
- The model still needs ids internally for `mirrorInfo` / `readResource` tool calls — those are
  unaffected; only the user-facing answer text is constrained.
- A user explicitly asking "what is the id of X" is out of policy scope; the guidance optimizes the
  default enumerated/grounded answer for humans.

## Requirements *(mandatory)*

- **FR-109**: The grounded chat MUST NOT print dataset ids / UUIDs / other technical identifiers in
  the answer text — datasets are referenced by their Bulgarian title in prose. The constraint is
  enforced via a clause in the shared `SYSTEM_PROMPT` so it applies to BOTH the tool-loop and RAG
  paths; identifiers remain available to the model for its tool calls, and the `citations` event still
  carries each dataset's id + source URL for the UI to link.
- **FR-110**: When listing/enumerating, the chat MUST treat the tool results as the complete, closed
  set — listing only datasets/entities present in them and never "rounding out" the list with datasets,
  publishers, municipalities, regions, or institutions known from training but not retrieved. This
  generalizes the geo-scope guardrail (spec 023 FR-101) to ALL enumerations, scoped or not, via a
  `SYSTEM_PROMPT` clause. Fixes the `registers-enum` eval fabrication (an unscoped register list padded
  with municipalities — Столична община, Русе, Добрич — absent from the grounding). Verified live:
  every municipality named in the answer now appears in the injected grounding.

## Success Criteria *(mandatory)*

- **SC-011**: Live answers contain zero dataset UUIDs and no `datasetId` column while citations are
  still emitted — verified with `deepseek-v4-pro`: "качество на въздуха" → 51 citations, 0 UUIDs in
  the answer; "регистри" (geo-scoped) → 144 citations, 0 UUIDs.

## Out of scope
- The **volume** of the citations list itself (e.g. an answer can cite many datasets) — capping or
  de-duplicating the citation chips is a separate UX concern, not addressed here.
- Any change to how the UI renders citations/links (unchanged).
