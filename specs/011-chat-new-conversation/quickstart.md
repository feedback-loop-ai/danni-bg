# Quickstart: New conversation + suggested-prompt empty state

**Feature**: `011-chat-new-conversation` | **Status**: Implemented (PR #15)

How to exercise and verify the feature locally. It is frontend-only; no backend
or data changes are involved.

## Prerequisites

- Bun installed (project runtime/toolchain).
- The explorer web app dependencies installed:

  ```bash
  cd apps/explorer-web
  bun install
  ```

## Run the explorer

```bash
cd apps/explorer-web
bun run dev
```

Open the printed local URL. The chat panel is on the right side of the
explorer.

## Try it

### Suggested-prompt empty state (User Story 2)

1. With no messages sent, look at the chat panel: it shows a centred grounding
   prompt ("Задайте въпрос за публичните данни …") plus three clickable example
   questions.
2. Click one of the example questions (e.g. *„Какви данни има за качеството на
   въздуха?"*).
3. Confirm it is sent as your message and the assistant begins answering — no
   typing required.

### Start a fresh conversation (User Story 1)

1. Have at least one exchange in the chat (type a question or click a
   suggestion). If the stubbed/real answer anchors regions, note the map
   highlight.
2. Click the new-conversation control in the chat header (the compose / pen
   icon, labelled "Нов разговор").
3. Confirm:
   - the transcript clears back to the suggested-prompt empty state,
   - any chat-driven map highlight is removed,
   - the input and any error are cleared,
   - a "Контекст: …" dataset focus chip, if present, is gone,
   - active map filters / selected region / open document reader / provider
     settings are unchanged.
4. Send another message and confirm it starts a fresh server session (no
   carried-over context from the previous conversation).
5. With the chat empty and idle, confirm the new-conversation control is
   disabled (dimmed) — there is nothing to reset.

### Mid-stream reset (edge case)

1. Send a question and, while the answer is still streaming, click "Нов
   разговор".
2. Confirm the stream stops immediately, the transcript clears, and **no** error
   message ("мрежова грешка") appears — a user-initiated abort is not an error.

## Automated checks

```bash
cd apps/explorer-web

# Type safety (Principle VII)
bun run typecheck

# Lint/format (Biome — Principle VI quality gate)
bun run lint

# Behavioral E2E (the chat flows that exercise send/scope/citations and
# the ask-about-dataset path remain green; the reset and empty-state paths
# are reachable through these flows)
bun run e2e
```

Expected (per PR #15): web typecheck and Biome clean; the Playwright chat
suite green with the existing send / scope / ask-about-dataset flows
unaffected.
