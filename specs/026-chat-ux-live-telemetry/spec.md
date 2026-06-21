# Feature Specification: Chat UX polish + live usage telemetry

**Feature Branch**: `026-chat-ux-live-telemetry`
**Created**: 2026-06-21
**Status**: Implemented (PRs #77 `0eaf83f`, #78 `3f012b8`, #80 `24debc4`, #82 `8b6941b` on `main`;
verified by live headless runs against `:8790` with `deepseek-v4-pro` + the full `bun:test` suite).
**Input**: A UX pass over the grounded chat — "a favicon for danni.bg", "an animation (in the mould of
Claude) when the chat is waiting", "monitor the tokens going upstream live"; then the correction "no
upstream tokens are incremented until the reply comes back — is that downstream not upstream? I want
arrow up and down for both, live"; then "keep, per request/response, the tokens consumed after the
reply (and not only on the UI)" and "a clock about how long it took to reply, also kept in the chat";
finally "same styling live as after completion, and all the data live streamed".

## Overview

Two threads of chat polish, shipped iteratively:

1. **Presentation** — danni.bg had no favicon, and a waiting turn showed only a static `…`. Add a
   brand favicon + a Claude-style "thinking" animation.
2. **Usage telemetry** — give the user live, then kept, visibility into what a turn costs: the input
   (↑, server-known) and output (↓) tokens *as they stream*, plus how long the reply took (⏱), shown
   in one place that looks identical live and after completion, and **persisted per message** so it
   survives a reload/resume — not just an ephemeral UI readout.

Token *billing/metering* (spec 021) is unchanged; this is a read-out, computed from the same usage the
server already records.

## Clarifications

### Session 2026-06-21

- Q: What visual cues? → A: a **favicon** (a path-based "data bars + locator dot" mark, brand blue +
  orange, served at `/favicon.svg`, with a `theme-color` meta) and a **Claude-style typing indicator**
  (three dots breathing out of phase) replacing the static `…` while a turn generates.
- Q: "Monitor tokens going upstream live" — the first counter only moved on the reply. Up or down? →
  A: that was **downstream/output**, mislabeled `↑`. True **input/upstream** tokens are only known
  server-side (the prompt = system + history + grounding rows), so the backend must report them. Show
  **both** ↑ input and ↓ output, live.
- Q: How does the backend report it without changing billing? → A: a new **`usage` SSE event** —
  `run.ts` emits cumulative usage **per provider step** (`onStepFinish`) plus an authoritative final
  total; it flows GenerationManager → SSE (forwarded live + replayed on the resume snapshot) →
  `sendChat` → ChatPanel. `readUsage`/metering is untouched.
- Q: "Keep the tokens after the reply, not only on the UI" + "a clock kept in the chat" → A: persist
  **per assistant message** — token usage + reply duration — so they show after the reply AND on
  reload/resume. Migration `014` adds `usage_json` + `duration_ms` to `chat_messages`.
- Q: "Same styling live as after completion, all data live" → A: one **`UsageFooter`** renders on the
  streaming bubble (live ↑/↓/⚡ tokens + a **ticking ⏱ clock**, pulsing dot) and on completed messages
  (persisted, identical styling). The separate between-messages meter was removed.

## User Scenarios & Testing *(mandatory)*

One responsibility: **a polished chat that shows, live and kept, what each turn cost.**

### User Story 1 — Visual cues (Priority: P3)

The site shows a danni.bg favicon in the browser tab, and while the assistant is preparing a reply the
chat shows an animated "thinking" indicator instead of a static `…`.

**Acceptance**
1. `/favicon.svg` is served and linked from `index.html` (+ a `theme-color`).
2. A generating turn shows the animated typing dots until the first token (incl. during tool-calling).

### User Story 2 — Live token + time telemetry (Priority: P2)

While a turn streams, the user sees the input (↑) and output (↓) tokens climb and a duration clock (⏱)
tick — all in one footer on the answer bubble.

**Acceptance**
1. ↑ input appears once the first step reports usage and grows across tool steps; ↓ output streams
   live (deltas, snapping to the server's exact count); ⏱ ticks while the turn runs.
2. The live footer and the completed footer use the **same** styling/layout.

### User Story 3 — Kept per turn (Priority: P2)

After the reply, the bubble keeps its tokens-consumed + reply-duration footer, and it's still there
after a reload or when reopening the conversation.

**Acceptance**
1. Each assistant turn persists its token usage + duration; both are returned by `getSession` and
   re-rendered on reload/resume (not just live state).

### Edge Cases
- The live ↓ counter is an approximation between `usage` events (one streamed delta ≈ one token); it
  snaps to the server's exact total when a `usage` event arrives and on completion.
- A single-step (RAG) turn reports usage once near the end, so ↑ appears late on that path; the
  tool-loop path reports per step, so ↑ appears mid-turn.
- The server does NOT auto-migrate — migration 014 must be applied with `bun run db:migrate` on deploy
  (otherwise the assistant-message append fails). 

## Requirements *(mandatory)*

- **FR-111**: The app MUST ship a favicon (`apps/explorer-web/public/favicon.svg`, path-based so it is
  crisp at 16px) linked from `index.html` with a `theme-color` meta.
- **FR-112**: While a turn is generating, the chat MUST show a Claude-style animated "thinking"
  indicator (dots breathing out of phase) in place of the static `…`.
- **FR-113**: The backend MUST surface live token usage via a `usage` SSE event — cumulative per
  provider step (`onStepFinish`) plus an authoritative final total — flowing through the
  GenerationManager (forwarded live + replayed on the resume snapshot), sendChat, to the UI. Token
  billing/metering (`readUsage`) MUST be unchanged.
- **FR-114**: Each assistant turn MUST persist its token usage (`{inputTokens, outputTokens,
  cachedInputTokens}`) and reply duration (ms) with the message (migration 014: `chat_messages`
  `usage_json` + `duration_ms`), returned by `getSession` and restored on reload/resume.
- **FR-115**: A single `UsageFooter` MUST render the per-turn telemetry identically **live** (on the
  streaming bubble: ↑ input · ↓ output · ⚡ cached tokens + a ticking ⏱ clock, with a pulsing dot) and
  **after completion** (persisted on the message), with no separate live-meter UI.

## Success Criteria *(mandatory)*

- **SC-012**: `/favicon.svg` serves `image/svg+xml` (HTTP 200); the typing indicator shows while a turn
  waits for its first token.
- **SC-013**: Live usage streams — backend `usage` events climb across steps (↑ 1189 → 55151 / ↓ 111 →
  2496, with cached) and the UI reflects it live (↑ 0 → 10801 / ↓ 0 → 318); the ⏱ clock ticks
  (0 → 0.5 → … → 3.5 s).
- **SC-014**: Per-turn tokens + duration are kept — the footer (`↑ 1299 · ↓ 231 · ⚡ 1280 ток. · ⏱ …`)
  is identical after a reload; the API round-trips `usage {↑1293, ↓55, cache 1280}` + `durationMs 1638`
  on the persisted assistant message.
- **SC-015**: Suite green — 183 explorer-api + 71 web tests pass (incl. a sessions-repo persistence
  round-trip for usage + duration); tsc + biome + web build clean.

## Out of scope
- Exact live **input** tokens *before* the first step finishes (input is one provider call; ↑ appears
  when the first usage is reported). Authoritative per-user totals also live on the account usage page
  (spec 021).
- Capping/de-duplicating the citations list (noted out of scope in spec 025).
