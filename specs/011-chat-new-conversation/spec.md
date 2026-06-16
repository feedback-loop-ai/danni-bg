# Feature Specification: New conversation + suggested-prompt empty state

**Feature Branch**: `011-chat-new-conversation`
**Created**: 2026-06-13
**Status**: Implemented
**Input**: User description: "Better chat UX, with the ability to start a fresh conversation, plus a suggested-prompt empty state so a first-time user sees example questions instead of a blank panel."

> **Retrospective spec.** This documents work already shipped and merged in
> PR #15 (`feat(chat): start a new conversation + suggested-prompt empty
> state`). It is a frontend-only enhancement to the chat panel of the map data
> explorer (feature 008). The grounded chat itself — backend retrieval, the SSE
> stream, citations, provider configuration — is owned by 008 and unchanged
> here.

## Overview

The grounded chat panel (feature 008, User Story 3) lets a visitor ask
plain-language questions about the curated `data.egov.bg` mirror and get
answers cited back to specific datasets, with chat results able to highlight
regions/datasets on the map. Two everyday gaps remained:

1. There was no way to **start over**. Once a conversation had run, the only
   way to clear the transcript, the in-memory server session, and any
   chat-driven map highlight was to reload the page (which also drops provider
   context and the rest of the explorer state).
2. The empty chat showed a single line of instructional text. A first-time
   visitor had no concrete idea of *what* they could ask.

This feature adds a "Нов разговор" (new conversation) control to the chat
header that resets the conversation and the chat-driven explorer state in
place, and replaces the one-line empty hint with a centred prompt plus three
clickable example questions that send immediately.

Because conversations are session-only and held in memory per server session
(feature 008, FR-019), "new conversation" does not delete persisted history —
there is none. It simply drops the current session id so the next message
starts a fresh server session, and clears the local transcript and chat-driven
state.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start a fresh conversation (Priority: P1)

A visitor has had an exchange with the chat — the transcript shows several
turns, and the assistant's last answer highlighted some regions/datasets on the
map. They now want to ask about a completely different topic without the prior
context bleeding in. They click the new-conversation control in the chat
header. The transcript empties back to the suggested-prompt state, any
in-flight answer stops, the chat-driven map highlight clears, the input and any
error clear, and the next question they send starts a brand-new server session.

**Why this priority**: This is the core of the feature and delivers standalone
value — a clean reset that does not require a full page reload (which would also
lose provider settings and the rest of the explorer view). Without it the only
reset path is reloading the page.

**Independent Test**: Run a chat exchange, confirm a transcript and (if the
stub anchors a region) a map highlight exist, click "Нов разговор", and verify
the transcript returns to the empty/suggested-prompt state, the chat-driven map
highlight is cleared, the input and error are empty, and the next message is
served as a new server session (no carried-over context).

**Acceptance Scenarios**:

1. **Given** a conversation with one or more turns, **When** the user activates
   "Нов разговор", **Then** the transcript is cleared and the suggested-prompt
   empty state is shown.
2. **Given** the assistant's last answer highlighted regions/datasets on the
   map, **When** the user activates "Нов разговор", **Then** the chat-driven map
   highlight is cleared.
3. **Given** an answer is still streaming, **When** the user activates "Нов
   разговор", **Then** the in-flight response is aborted and no further tokens
   are appended.
4. **Given** a "Контекст: <dataset>" focus chip is active (from "ask about this
   dataset"), **When** the user activates "Нов разговор", **Then** the focus
   chip and any prefilled input are cleared.
5. **Given** the chat is already empty with no active focus, stream, or error,
   **When** the user looks at the new-conversation control, **Then** it is
   disabled (nothing to reset).
6. **Given** an error message is shown after a failed answer, **When** the user
   activates "Нов разговор", **Then** the error is cleared.
7. **Given** a fresh conversation has been started, **When** the user sends the
   next message, **Then** it begins a new server session (no prior session id is
   sent) and prior turns do not influence the answer.

---

### User Story 2 - See example questions on an empty chat (Priority: P2)

A first-time visitor opens the explorer and looks at the chat panel before
typing anything. Instead of a single line of instructions, they see a centred
prompt explaining that answers are grounded in the public datasets and cite
their sources, plus three concrete example questions. Clicking any example
sends it immediately, so the visitor can experience a grounded answer without
having to compose a question first.

**Why this priority**: It lowers the cold-start barrier and teaches the chat's
capability by example, but the chat is fully usable without it (a user can
always type a question). It depends on the chat (008) being present and is
additive.

**Independent Test**: Load the explorer with an empty chat and confirm the
empty state shows the grounding prompt plus three clickable example questions;
click one and confirm it is sent as the user's message and an answer streams in.

**Acceptance Scenarios**:

1. **Given** the chat has no messages, **When** the panel renders, **Then** a
   centred grounding prompt and three suggested example questions are shown
   instead of the transcript.
2. **Given** the suggested-prompt empty state is shown, **When** the user clicks
   one of the example questions, **Then** that exact question is sent as the
   user's message and the assistant begins answering.
3. **Given** at least one message exists in the transcript, **When** the panel
   renders, **Then** the empty state (prompt + suggestions) is not shown and the
   transcript is shown instead.
4. **Given** an answer is currently streaming, **When** the user clicks an
   example question, **Then** the click is ignored (no message is sent), matching
   the FR-010 streaming guard on a typed send.

---

### Edge Cases

- **New conversation while streaming**: Activating "Нов разговор" mid-stream
  aborts the in-flight fetch; the abort is treated as a user action, not a
  network error, so no error message is surfaced.
- **Disabled control with nothing to reset**: When the chat is empty and there
  is no active stream, focus chip, or error, the new-conversation control is
  disabled so the user cannot trigger a no-op reset.
- **Suggestion clicked while a previous answer is still streaming**: A send is
  ignored while streaming, so a suggestion click during streaming has no effect
  (consistent with the send button being unavailable while streaming).
- **Reset does not touch unrelated explorer state**: Starting a new
  conversation clears only chat-driven state (transcript, session, chat-driven
  map highlight, input, error, dataset focus). Active map filters, the selected
  region, the document reader, and saved provider settings are left untouched.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The chat panel MUST provide a labelled "new conversation" control
  in its header that starts a fresh conversation.
- **FR-002**: Activating the new-conversation control MUST clear the visible
  transcript so the panel returns to its empty state.
- **FR-003**: Activating the new-conversation control MUST drop the current
  server session identifier so the next message begins a new in-memory server
  session (consistent with conversations being session-only — feature 008
  FR-019).
- **FR-004**: Activating the new-conversation control MUST abort any in-flight
  answer stream, and the resulting abort MUST NOT be surfaced as an error.
- **FR-005**: Activating the new-conversation control MUST clear the chat-driven
  map highlight (the regions/datasets anchored by a prior answer).
- **FR-006**: Activating the new-conversation control MUST clear the dataset
  focus context ("ask about this dataset"), the input field, and any displayed
  error.
- **FR-007**: Activating the new-conversation control MUST NOT alter unrelated
  explorer state — active map filters, the selected region, the document
  reader, and the saved provider/model selection MUST be preserved.
- **FR-008**: The new-conversation control MUST be disabled when there is
  nothing to reset — i.e. the transcript is empty AND no answer is streaming AND
  no dataset focus is active AND no error is shown.
- **FR-009**: When the transcript is empty, the chat panel MUST show a
  suggested-prompt empty state consisting of a grounding prompt and exactly three
  clickable example questions, in place of the transcript.
- **FR-010**: Clicking an example question in the empty state MUST send that
  exact question as the user's message (subject to the same guards as a typed
  send — e.g. ignored while an answer is streaming).
- **FR-011**: The empty state MUST be shown only while the transcript is empty;
  once any message exists, the transcript MUST be shown instead.
- **FR-012**: All chat-panel user-facing strings introduced by this feature
  (control label/title, prompt, example questions) MUST be in Bulgarian and
  preserve Cyrillic exactly.

### Key Entities *(include if feature involves data)*

- **Conversation (client view)**: The in-memory, session-only exchange shown in
  the chat panel — an ordered list of user/assistant messages plus the current
  server session id. Starting a new conversation empties this list and drops the
  session id. Not persisted (feature 008 FR-019).
- **Suggested prompt**: A fixed, ordered set of example Bulgarian questions
  shown in the empty state. Each is a literal question string that, when
  clicked, is sent verbatim as the user's message.
- **Chat-driven map highlight**: The set of geographic-entity and dataset ids a
  prior answer anchored on the map (owned by the shared explorer state; see
  feature 008). A new conversation resets it to empty.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can fully reset the conversation (transcript, server
  session, chat-driven map highlight, input, error, dataset focus) without
  reloading the page, in a single action.
- **SC-002**: After starting a new conversation, 0 prior messages remain in the
  transcript and 0 regions/datasets remain highlighted from the previous
  conversation.
- **SC-003**: After starting a new conversation, all explorer state other than
  the chat (active filters, selected region, document reader, provider/model
  selection) is unchanged.
- **SC-004**: A first-time visitor who has sent no messages sees exactly three
  concrete example questions and can obtain a grounded answer by a single click,
  with no typing required.
- **SC-005**: The new-conversation control is non-actionable (disabled) whenever
  there is nothing to reset, so the action is never a confusing no-op.

## Assumptions

- Conversations are session-only and held in memory per server session (feature
  008, FR-019); there is no persisted conversation history to list, restore, or
  delete. "New conversation" therefore means "start a new session", not "save
  and archive the old one".
- The chat-driven map highlight and dataset focus are part of the shared
  explorer state introduced by feature 008; this feature reuses the existing
  setters rather than introducing new state.
- The set of example questions is a small, hard-coded, curated list chosen to
  reflect representative datasets in the mirror; it is not generated dynamically
  in v1.
- Provider/model selection is stored client-side (feature 008, FR-024) and is
  intentionally out of scope for the reset, so a user does not lose their
  configured provider when starting a new conversation.
- This feature is frontend-only: it adds no backend endpoint and consumes no new
  portal endpoint or dataset, so it introduces no new API contract.
