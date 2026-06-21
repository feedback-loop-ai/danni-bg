# Tasks: Chat UX polish + live usage telemetry

Retrospective task list (all complete), grouped by the PR that landed each.

## Phase 1 — Visual cues (PR #77, frontend)

- [x] T001 Favicon `apps/explorer-web/public/favicon.svg` (path-based data-bars + locator dot), linked
  in `index.html` + `theme-color` meta. — FR-111
- [x] T002 `TypingDots` component + `danni-typing` keyframe (`index.css`); replace the static `…` while
  a turn generates. — FR-112
- [x] T003 (initial live token counter — superseded by FR-113/FR-115.)

## Phase 2 — Live usage telemetry (PR #78, backend → frontend)

- [x] T004 `run.ts`: `onUsage` event; `onStepFinish` accumulates cumulative usage; final authoritative
  `readUsage` emit; both tool-loop + RAG paths. Billing unchanged. — FR-113
- [x] T005 GenerationManager: `usage` `GenEvent` + `onUsage` handler + snapshot field (resume replay).
  routes/chat.ts: forward `event: usage` + replay from snapshot; pass `onUsage` to `runChatTurn`. — FR-113
- [x] T006 sendChat.ts: parse `event: usage` → `onUsage`. — FR-113

## Phase 3 — Kept per turn (PR #80, persistence)

- [x] T007 migration `014_message_usage_duration.sql` (chat_messages `usage_json` + `duration_ms`).
  — FR-114
- [x] T008 session.ts/sessions-repo.ts: `ChatMessage` gains `usage` + `durationMs`; persisted + read.
  — FR-114
- [x] T009 routes/chat.ts: time the run closure; append assistant message with `result.usage` +
  `durationMs`. — FR-114
- [x] T010 ChatPanel: stamp the finished turn; re-hydrate `usage`/`durationMs` from `getSession`. — FR-114
- [x] T011 Test: `sessions-repo` persistence round-trip (usage + duration kept across resume).

## Phase 4 — Unified footer (PR #82, frontend)

- [x] T012 One `UsageFooter({ usage, durationMs, live })` — identical live + persisted styling; pulsing
  dot + ticking ⏱ when live. — FR-115
- [x] T013 `elapsedMs` ticking `useEffect` (100ms while streaming); render live values on the trailing
  streaming bubble, persisted values on completed messages; remove the separate meter. — FR-115

## Notes
- Migration 014 is a manual deploy step: `bun run db:migrate` (the server does not auto-migrate).
- Metering/billing (`token_usage`, spec 021) is unchanged — this is a read-out of the same usage.
