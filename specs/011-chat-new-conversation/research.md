# Research: New conversation + suggested-prompt empty state

**Feature**: `011-chat-new-conversation` | **Status**: Implemented (PR #15)

Phase 0 research. This is a small frontend UX feature on top of the existing
grounded chat (feature 008); the "research" here is the set of design decisions
behind the reset semantics and the empty state, each with the alternatives that
were rejected.

## Decision 1 — "New conversation" means "new session", not "saved history"

**Decision**: The control drops the current server session id and clears the
local transcript; it does not archive, list, or restore prior conversations.

**Rationale**: Conversations are session-only and held in memory per server
session (feature 008, FR-019, confirmed by the 008 clarification "conversations
are session-only … not stored server-side in v1"). There is no persisted
history to manage, so a multi-conversation history list would require new
persistence that the product explicitly deferred.

**Alternatives considered**:
- *Persisted conversation list with restore* — rejected: contradicts FR-019 and
  adds server-side storage out of scope for v1 (YAGNI, Principle V).
- *Full page reload to reset* — rejected: also discards provider settings and
  the rest of the explorer view (filters, selected region, reader), which the
  user did not ask to lose.

## Decision 2 — What the reset clears (and what it preserves)

**Decision**: `newChat()` clears only chat-driven state: abort the in-flight
stream, empty `messages`, null the `sessionId`, clear `input` and `error`, call
`setChatFocus(null)`, and `setHighlight({ geoEntityIds: [], datasetIds: [] })`.
It leaves filters, selected region, the document reader, and provider settings
untouched.

**Rationale**: The map highlight and dataset focus are *chat-driven* outputs of
the conversation, so they belong to the reset (FR-005/FR-006). Filters, region,
reader, and provider are the user's own broader exploration context and have no
dependency on the conversation, so resetting them would be surprising data loss
(FR-007). The highlight setters already exist in `explorerStore`, so reuse is
free.

**Alternatives considered**:
- *Reset everything including filters* — rejected: destroys the user's
  exploration context; violates least-surprise and SC-003.
- *Leave the map highlight in place* — rejected: a stale highlight from a
  discarded conversation is misleading once that conversation is gone.

## Decision 3 — Distinguish a user abort from a network error

**Decision**: `newChat()` calls `abortRef.current?.abort()`. The existing
`send()` catch already checks `controller.signal.aborted` and only sets an error
when the abort was *not* user-initiated, so a reset-triggered abort surfaces no
error.

**Rationale**: Aborting because the user started a new conversation is an
intended outcome, not a failure; showing "мрежова грешка" would be wrong. This
reuses the same abort plumbing as the existing "stop" button.

**Alternatives considered**:
- *Let the stream finish, then clear* — rejected: wastes the provider call and
  briefly shows tokens for a conversation the user just abandoned.

## Decision 4 — Disable the control when there is nothing to reset

**Decision**: The control is disabled when `empty && !streaming && !chatFocus &&
!error` (i.e. no messages, no active stream, no dataset focus, no error).

**Rationale**: With nothing to reset the action is a no-op; a disabled,
dimmed control communicates that clearly and prevents a confusing "I clicked it
and nothing happened" (FR-008, SC-005).

**Alternatives considered**:
- *Always enabled* — rejected: a no-op click is confusing.
- *Hide the control when idle* — rejected: a control that appears/disappears is
  more jarring than one that dims; disabled state keeps layout stable.

## Decision 5 — Generalise `send()` rather than add a second send path

**Decision**: Change the signature to `send(text?: string)` and use `(text ??
input).trim()`; suggestion buttons call `send(question)`. Typed sends still call
`send()` with no argument.

**Rationale**: A suggestion is just a pre-composed message; routing it through
the same `send()` keeps all the guards (ignore-while-streaming, scope assembly,
grounding, streaming, citation rendering) in one place rather than duplicating
them. Minimal change, single source of truth (Principle V).

**Alternatives considered**:
- *Separate `sendSuggestion()`* — rejected: duplicates the entire send pipeline
  and risks the two paths drifting apart.
- *Prefill the input, require a second click* — rejected: more friction; the
  goal is one-click to a grounded answer (SC-004).

## Decision 6 — Suggested prompts are a fixed, curated Bulgarian list

**Decision**: A hard-coded `SUGGESTIONS` array of three Bulgarian example
questions reflecting representative mirror datasets (air quality, road-accident
fatalities by year, municipal budgets).

**Rationale**: Three concrete examples teach the chat's capability with no
cold-start typing and no backend round-trip. They are static literals, so there
is no validation boundary and no locale risk beyond preserving the Cyrillic
strings exactly (Principle X).

**Alternatives considered**:
- *Dynamically generated suggestions from the mirror* — rejected: adds a network
  call and backend surface for marginal benefit in v1 (YAGNI).
- *Keep the single-line hint only* — rejected: it does not teach what to ask;
  the empty state is the main onboarding moment.

## Decision 7 — Icon and placement

**Decision**: Use the `SquarePen` icon from `lucide-react` (already a project
dependency) in the chat header, to the left of the existing settings (cog)
control, grouped in a small flex row.

**Rationale**: `SquarePen` is the conventional "compose / new" affordance and
matches the existing icon-button styling; no new dependency. Header placement
keeps the action discoverable next to other chat-level controls.

**Alternatives considered**:
- *A text button* — rejected: inconsistent with the icon-button header; the
  `aria-label`/`title` "Нов разговор" already provides the accessible name.

## Validation approach

No automated test added by this feature exercises `newChat()` or the
suggested-prompt empty state; those inline branches in `ChatPanel.tsx` were
validated **manually** (see `quickstart.md` and the Principle VIII waiver in
`plan.md`). The pre-existing feature-008 Playwright chat flows
(`apps/explorer-web/e2e/us3-chat.e2e.ts` and the ask-about-dataset flow) do
**not** target this feature's behavior — they serve only as a regression guard
that the shared chat pipeline still works. PR #15 reports web typecheck + Biome
clean and the existing suite remaining green, with the chat send / scope /
ask-about-dataset flows unaffected.
