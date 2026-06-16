---
description: "Task list for 011-chat-new-conversation (retrospective; shipped in PR #15)"
---

# Tasks: New conversation + suggested-prompt empty state

**Input**: Design documents from `/specs/011-chat-new-conversation/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: This frontend-only feature added no automated tests for its own
branches (`newChat()`, the empty state). The pre-existing feature-008 Playwright
chat flows are kept green only as a regression guard for the shared chat
pipeline; the feature's own reset/empty-state behavior was validated manually
(see the Principle VIII waiver in `plan.md` and `quickstart.md`). Test-related
tasks below reflect that regression surface, not new coverage.

**Organization**: Tasks are grouped by user story. Status reflects merged work
in PR #15 (`feat(chat): start a new conversation + suggested-prompt empty
state`); all tasks are complete `[X]`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)
- All work is in `apps/explorer-web/src/chat/ChatPanel.tsx` unless noted

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the surface to change; no project scaffolding needed (the
explorer web app already exists from feature 008).

- [X] T001 Confirm the feature is frontend-only and scoped to the chat panel:
  the existing shared explorer store (`apps/explorer-web/src/store/explorerStore.ts`)
  already exposes `setHighlight` and `setChatFocus`, so no store/type changes
  are required.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core change both stories depend on — generalise the send path so a
suggestion can send a literal question and so the reset has a clean send to
return to.

**⚠️ CRITICAL**: Blocks US1 and US2.

- [X] T002 Generalise `send()` to `send(text?: string)` using `(text ??
  input).trim()` in `apps/explorer-web/src/chat/ChatPanel.tsx`, preserving the
  ignore-while-streaming guard and the existing scope/grounding/streaming
  pipeline.

**Checkpoint**: Send accepts an optional text override; typed sends and
programmatic sends share one pipeline.

---

## Phase 3: User Story 1 - Start a fresh conversation (Priority: P1) 🎯 MVP

**Goal**: A single control that resets the conversation and chat-driven explorer
state in place, without a page reload.

**Independent Test**: Run an exchange, click "Нов разговор", verify the
transcript empties to the suggested-prompt state, the chat-driven map highlight
clears, input/error clear, the focus chip clears, unrelated explorer state is
preserved, and the next message starts a new server session.

### Implementation for User Story 1

- [X] T003 [US1] Add `newChat()` in `apps/explorer-web/src/chat/ChatPanel.tsx`
  that aborts the in-flight stream (`abortRef.current?.abort()`, set ref null,
  `setStreaming(false)`) and resets chat-local state: `setMessages([])`,
  `setSessionId(null)`, `setError(null)`, `setInput('')` (FR-002/FR-003/FR-004/FR-006).
- [X] T004 [US1] In `newChat()`, clear chat-driven shared state via
  `setChatFocus(null)` and `setHighlight({ geoEntityIds: [], datasetIds: [] })`
  while leaving filters/region/reader/provider untouched (FR-005/FR-006/FR-007).
- [X] T005 [US1] Add the header "Нов разговор" icon button (lucide `SquarePen`)
  next to the settings (cog) button, grouped in a flex row, with
  `aria-label`/`title` "Нов разговор" wired to `newChat` (FR-001).
- [X] T006 [US1] Disable the control when there is nothing to reset:
  `disabled={empty && !streaming && !chatFocus && !error}`, with dimmed disabled
  styling (FR-008, SC-005).
- [X] T007 [US1] Verify a reset-triggered abort is not surfaced as an error —
  the existing `send()` catch already ignores `controller.signal.aborted`
  (FR-004 edge case).

**Checkpoint**: New conversation fully resets chat-driven state in one action
and preserves the rest of the explorer.

---

## Phase 4: User Story 2 - See example questions on an empty chat (Priority: P2)

**Goal**: Replace the one-line empty hint with a grounding prompt plus three
clickable example questions that send immediately.

**Independent Test**: Load with an empty chat, confirm the prompt + three
example questions render; click one and confirm it is sent and an answer
streams.

### Implementation for User Story 2

- [X] T008 [US2] Add the `SUGGESTIONS` constant (three Bulgarian example
  questions) at module scope in `apps/explorer-web/src/chat/ChatPanel.tsx`
  (FR-012; Cyrillic preserved exactly).
- [X] T009 [US2] Derive `const empty = messages.length === 0` and render the
  suggested-prompt empty state only while `empty` — a centred grounding prompt
  plus the three example buttons — replacing the prior single-line hint
  (FR-009/FR-011).
- [X] T010 [US2] Wire each suggestion button to `onClick={() => void send(s)}`
  so the literal question is sent (FR-010), reusing the generalised `send()`
  from T002.

**Checkpoint**: First-time users see and can one-click example questions.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Quality gates across both stories.

- [X] T011 [P] Pass TypeScript typecheck for the explorer web app (`bun run
  typecheck`) — Principle VII.
- [X] T012 [P] Pass Biome lint/format clean — Principle VI quality gate.
- [X] T013 Confirm the existing suite remains green — the pre-existing
  feature-008 Playwright chat flows (chat send / scope / ask-about-dataset in
  `apps/explorer-web/e2e/`) are a regression guard only; none of them target this
  feature's `newChat()` reset or empty-state branches. Those branches were
  validated manually (see the Principle VIII waiver in `plan.md` and
  `quickstart.md`), not by automated test.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: `send(text?)` — blocks US1 and US2.
- **User Story 1 (Phase 3)**: After Foundational; the MVP slice.
- **User Story 2 (Phase 4)**: After Foundational; independently testable.
- **Polish (Phase 5)**: After both stories.

### User Story Dependencies

- **US1 (P1)**: Depends on T002 (a clean send to return to). Otherwise standalone.
- **US2 (P2)**: Depends on T002 (suggestions send via `send(text)`). Otherwise
  standalone — the empty state renders regardless of US1.

### Parallel Opportunities

- T011 and T012 are independent quality gates and can run in parallel.
- US1 (T003–T007) and US2 (T008–T010) edit the same file (`ChatPanel.tsx`), so
  while logically independent they were applied together to avoid conflicts.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001–T002 (Setup + Foundational).
2. T003–T007 (US1) → reset works without a page reload.
3. Validate US1 independently, then layer US2 (T008–T010).

### Notes

- [P] tasks = independent gates; [Story] maps tasks to US1/US2 for traceability.
- All work landed in PR #15; statuses are `[X]`.
