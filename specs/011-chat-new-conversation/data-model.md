# Data Model: New conversation + suggested-prompt empty state

**Feature**: `011-chat-new-conversation` | **Status**: Implemented (PR #15)

This feature adds **no persisted data** and **no new store slice**. Conversations
are session-only and held in memory per server session (feature 008, FR-019).
The model below describes the client-side state the chat panel touches and how
"new conversation" transitions it. All of it is transient in-browser state in
`apps/explorer-web/src/chat/ChatPanel.tsx`; the shared pieces live in the
existing `explorerStore`.

## Client-side state touched

### Chat-local state (React state in `ChatPanel.tsx`)

| Field | Type | Meaning | On new conversation |
|-------|------|---------|----------------------|
| `messages` | `ChatMessage[]` | Ordered transcript of user/assistant turns shown in the panel | Reset to `[]` |
| `sessionId` | `string \| null` | Current server session id (returned by the backend on first message); sent on subsequent messages to retain context | Reset to `null` (next send starts a new server session) |
| `input` | `string` | Current contents of the question textarea | Reset to `''` |
| `error` | `string \| null` | Last surfaced chat error (e.g. "мрежова грешка") | Reset to `null` |
| `streaming` | `boolean` | Whether an answer is currently streaming | Set to `false` after aborting the stream |
| `abortRef` | `AbortController \| null` (ref) | Controls the in-flight SSE fetch | `.abort()` then set to `null` |

`ChatMessage` (unchanged, defined in `ChatPanel.tsx`):

| Field | Type | Meaning |
|-------|------|---------|
| `id` | `number` | Monotonic local id (from `idRef`) |
| `role` | `'user' \| 'assistant'` | Author of the turn |
| `content` | `string` | Markdown text (assistant content streams in) |
| `citations?` | `Citation[]` | Datasets the assistant cited |

### Shared explorer state (existing `explorerStore`, reused not changed)

| Field | Type | Meaning | On new conversation |
|-------|------|---------|----------------------|
| `chatFocus` | `ChatFocus \| null` | Dataset the chat is focused on ("ask about this dataset") | `setChatFocus(null)` |
| `highlight` | `MapAnchor` | Regions/datasets a prior answer anchored on the map | `setHighlight({ geoEntityIds: [], datasetIds: [] })` |

State intentionally **not** touched by the reset: `filters`, `selectedRegionId`,
`reader`, and the client-stored provider/model selection (FR-007).

## Derived values

| Name | Definition | Used for |
|------|------------|----------|
| `empty` | `messages.length === 0` | Gate the suggested-prompt empty state (FR-009/FR-011) and contribute to the disabled condition (FR-008) |
| control `disabled` | `empty && !streaming && !chatFocus && !error` | Disable the new-conversation control when there is nothing to reset (FR-008) |

## Constants

| Name | Type | Meaning |
|------|------|---------|
| `SUGGESTIONS` | `string[]` (length 3) | Fixed, curated Bulgarian example questions rendered as clickable buttons in the empty state (FR-009/FR-010). Sent verbatim via `send(s)`. |

Shipped values:

1. `Какви данни има за качеството на въздуха?`
2. `Сравни ПТП с фатален край по години`
3. `Кои набори са за бюджета на общините?`

## State transitions

### Start a new conversation (`newChat()`)

```text
(any conversation state)
  ── activate "Нов разговор" ──▶
    abort in-flight stream (no error surfaced)
    messages := []          sessionId := null
    input   := ''           error     := null
    streaming := false
    chatFocus := null       highlight := { geoEntityIds: [], datasetIds: [] }
  ──▶ (empty state: suggested prompt + 3 example questions shown)
```

### Send (typed or from a suggestion) — unchanged pipeline, generalised entry

```text
send(text?)
  question := (text ?? input).trim()
  if !question or streaming → ignore
  else → append user + empty-assistant turns, stream answer,
         on first response receive/keep sessionId
```

## Notes

- No migrations, no schema, no portal endpoint, no MCP tool — nothing to
  version. The feature is purely a client-side state transition plus a render
  branch.
