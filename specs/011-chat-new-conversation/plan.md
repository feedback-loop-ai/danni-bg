# Implementation Plan: New conversation + suggested-prompt empty state

**Branch**: `011-chat-new-conversation` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-chat-new-conversation/spec.md`

> **Retrospective plan.** Records the design of work already merged in PR #15.
> Status: Implemented.

## Summary

Add a "Нов разговор" (new conversation) control to the chat panel header that
resets the conversation and chat-driven explorer state in place, and replace
the one-line empty hint with a suggested-prompt empty state (a grounding prompt
plus three clickable example questions that send immediately).

Technical approach: a frontend-only change contained entirely in the existing
chat panel component (`apps/explorer-web/src/chat/ChatPanel.tsx`). A `newChat()`
handler aborts any in-flight stream and resets local chat state (`messages`,
`sessionId`, `input`, `error`) plus the shared explorer state it already
consumes (`setChatFocus(null)`, `setHighlight({ geoEntityIds: [], datasetIds:
[] })`). The existing `send()` is generalised to accept an optional text
override so suggestion buttons can send a literal question. No store, type,
backend, or contract changes.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: React 18, Zustand (existing `explorerStore`),
`lucide-react` (adds the `SquarePen` icon), Tailwind CSS; no new dependency
added
**Storage**: N/A — conversations are session-only and held in memory per server
session (feature 008, FR-019); nothing is persisted by this feature
**Testing**: Playwright E2E (`apps/explorer-web/e2e/`), TypeScript typecheck,
Biome lint/format
**Target Platform**: Browser SPA (the explorer web app, served by Vite)
**Project Type**: Web application — frontend only for this feature
**Performance Goals**: Reset and empty-state render are instantaneous local
state updates (no network); no measurable budget beyond perceived-instant UI
**Constraints**: Reset MUST NOT touch unrelated explorer state (filters,
selected region, reader, provider settings); abort of an in-flight stream MUST
NOT be reported as an error; all new strings in Bulgarian with exact Cyrillic
**Scale/Scope**: One component changed; 1 user-visible control + 1 empty-state
block + 1 helper function; 3 hard-coded example questions

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution v1.1.0. This is a frontend-only UI enhancement to an existing
panel; the data-substrate principles are out of scope but none are violated.

- **I. AI-Native Development** — N/A to a UI control. The read path is
  untouched; the chat still answers only from the curated mirror via the
  backend. No portal data is invented, summarised, or altered by this change.
  PASS.
- **II. Spec-Driven Development (SDD)** — WHAT in `spec.md`, HOW here in
  `plan.md`, VALIDATION via the existing Playwright chat E2E plus this plan's
  task checkpoints. PASS (retrospective).
- **III. Contract-First API Design** — No MCP tool and no portal endpoint is
  added or changed; no new contract. `contracts/` is intentionally empty (see
  `contracts/.gitkeep`). PASS (not applicable).
- **IV. Operational Excellence** — Client-only state transition. A user-
  initiated stream abort is explicitly distinguished from a network error and
  not surfaced as one (graceful, non-alarming). PASS.
- **V. Simplicity & YAGNI** — The reset reuses existing state setters and the
  existing `send()`; no new store slice, no persisted history list, no
  dynamically generated suggestions. Each requirement maps to an FR. PASS.
- **VI. Fast Feedback Loops** — No new tooling; Vite hot reload, Biome, and the
  existing Playwright suite cover the inner loop. PASS.
- **VII. Type Safety & Validation** — TypeScript strict; `send(text?: string)`
  is typed; no `any`. No external/boundary input is introduced (suggestions are
  literal in-app constants), so no new Zod boundary is required. PASS.
- **VIII. 100% Test Coverage & Endpoint Parity** — **WAIVER (logged).** No
  automated test added or extended by this feature exercises `newChat()` (the
  reset / abort-guard / disabled-control branches) or the suggested-prompt
  empty-state render; those branches live inline in `ChatPanel.tsx` and are not
  segregated into a separately-covered module, so the browser/UI-glue exception's
  preconditions are NOT met and cannot be claimed. The pre-existing Playwright
  flows under feature 008 (chat send / scope / ask-about-dataset) do not target
  this feature's behavior. These branches were therefore validated **manually**
  (see `quickstart.md`), not by automated test. This is an accepted coverage
  deviation recorded in Complexity Tracking below. No portal endpoint or dataset
  is consumed, so no parity-matrix entry is required.
- **IX. Data Freshness & Sync Integrity** — N/A; no read response, freshness
  block, or sync behaviour is touched. PASS.
- **X. Bulgarian-Locale Awareness** — All new user-facing strings ("Нов
  разговор", the grounding prompt, the three example questions) are Bulgarian
  with Cyrillic preserved exactly; code/comments are English. PASS.
- **XI. Respectful Crawling** — N/A; no crawler interaction. PASS.

One accepted deviation: the Principle VIII coverage waiver above (see Complexity
Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/011-chat-new-conversation/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — UX/behaviour decisions
├── data-model.md        # Phase 1 — client-side state touched (no persistence)
├── quickstart.md        # Phase 1 — how to exercise the feature
├── contracts/           # Empty — frontend-only, no API contract (.gitkeep)
├── checklists/
│   └── requirements.md  # Requirements-quality checklist
└── tasks.md             # Implementation task list (done)
```

### Source Code (repository root)

```text
apps/explorer-web/
├── src/
│   ├── chat/
│   │   └── ChatPanel.tsx        # CHANGED: newChat(), suggested-prompt empty
│   │                            #   state, send(text?) override, header control
│   └── store/
│       └── explorerStore.ts     # Unchanged — reused setHighlight/setChatFocus
└── e2e/
    └── us3-chat.e2e.ts          # Existing chat E2E (regression surface)
```

**Structure Decision**: The change is confined to the explorer web app's chat
component. No new files are created in source; the feature reuses the existing
shared explorer store (`setHighlight`, `setChatFocus`) and the existing
streaming `send()` path. The only source file modified is
`apps/explorer-web/src/chat/ChatPanel.tsx`.

## Complexity Tracking

> One accepted coverage deviation against Principle VIII (logged waiver).

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle VIII: `newChat()` (reset / abort-guard / disabled-control) and the suggested-prompt empty-state render ship without automated test coverage; validated manually instead. | The branches are inline UI glue in `ChatPanel.tsx`; the shipped PR added no test exercising them, and the pre-existing feature-008 Playwright flows do not target this behavior. | Adding a dedicated component/E2E test (the honest fix) was not done in PR #15; segregating the logic into a separately-covered module was not warranted for this small UI change. The deviation is accepted and logged rather than masked by claiming E2E coverage that does not exist. |
