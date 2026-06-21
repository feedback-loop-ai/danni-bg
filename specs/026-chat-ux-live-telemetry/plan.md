# Implementation Plan: Chat UX polish + live usage telemetry

**Spec**: [spec.md](./spec.md) · **Status**: Implemented (retrospective for PRs #77/#78/#80/#82).
Stack unchanged: Bun + TypeScript monorepo, Hono API + SSE, React/Vite/Tailwind SPA, SQLite via
`ReadBridge`/repos. Locked test runner `bun:test`.

## Architecture

### 1. Presentation (PR #77, frontend)
- `apps/explorer-web/public/favicon.svg` — a path-based mark (no font dependency → crisp at 16px),
  linked from `index.html` with `<link rel="icon" type="image/svg+xml">` + `<meta name="theme-color">`.
- `TypingDots` component + a `danni-typing` keyframe in `index.css`: three dots, staggered
  `animationDelay`, breathing out of phase; rendered while the streaming bubble has no content yet.

### 2. Live usage telemetry (PR #78, backend → frontend)
- **`run.ts`**: a `ChatTurnEvents.onUsage` callback. `streamText` gets an `onStepFinish` that
  accumulates per-step `{inputTokens, outputTokens, cachedInputTokens}` and emits the cumulative total
  (so ↑ input grows across tool steps, ↓ output per step). After the stream, the authoritative
  `readUsage(result)` is emitted once more to reconcile (and add cached). Applied to both the tool-loop
  and the RAG paths. **Billing/metering is unchanged** — it still reads `readUsage`.
- **GenerationManager**: a `usage` `GenEvent` + `onUsage` handler; the latest usage is stored on the
  generation and included in the snapshot, so a re-attaching client (mid-stream resume) gets it.
- **routes/chat.ts**: forwards the `usage` event over SSE (`event: usage`) and replays it from the
  snapshot on resume; passes `onUsage` into `runChatTurn`.
- **sendChat.ts**: parses `event: usage` into an `onUsage` callback.

### 3. Kept per turn (PR #80, persistence)
- **migration 014**: `chat_messages` gains `usage_json` + `duration_ms`. Applied via
  `bun run db:migrate` (the explorer-api server does not auto-migrate — discovered the hard way; the
  user-message append fails until the columns exist).
- **session.ts / sessions-repo.ts**: `ChatMessage` gains `usage` + `durationMs`; persisted on append,
  read back in `messages()`; surfaced by `getSession`.
- **routes/chat.ts**: the detached run closure times the turn (`Date.now()` span) and appends the
  assistant message with `result.usage` + `durationMs`.
- **ChatPanel**: stamps the finished turn (final usage from the `usage` event + measured duration),
  and re-hydrates `usage`/`durationMs` from `getSession` on reload/resume.

### 4. Unified footer (PR #82, frontend)
- One `UsageFooter({ usage, durationMs, live })` — identical markup live and persisted; `live` adds the
  pulsing dot + uses the live state. A `useEffect` ticks `elapsedMs` every 100ms while `streaming`,
  resetting per turn. The render picks live values (state) for the trailing streaming bubble and the
  persisted `m.usage`/`m.durationMs` for completed messages. The separate between-messages meter was
  removed.

## Why this shape
- **One SSE event, billing untouched.** Reusing the already-computed usage keeps metering authoritative
  while giving the client a live read-out; emitting per-step makes ↑ input genuinely live on the
  tool-loop path.
- **Persist where the message lives.** Tokens + duration belong to the turn, so they ride on the
  `chat_messages` row — automatically resumable (spec 020) and reload-safe, no new endpoint.
- **One footer component.** Live and completed must look the same (user requirement), so they share one
  component; only the data source and the pulsing dot differ.

## Testing & verification
- Unit: `sessions-repo` persistence round-trip (usage + duration); existing chat/SSE tests unchanged.
- Live (headless `:8790`, hermetic suite stays offline per Constitution VI): favicon 200; typing dots
  while waiting; backend usage events climbing; UI ↑/↓ live; ⏱ ticking; footer identical after reload;
  API round-trip of persisted usage + duration.
- Suites: 183 explorer-api + 71 web `bun:test`; tsc + biome + web build.

## Risks / tradeoffs
- The live ↓ counter is delta-approximated between `usage` events (snaps to exact on each event +
  completion). The live ⏱/↑ are best-effort live; the persisted values are authoritative.
- Migration 014 is a manual deploy step (`bun run db:migrate`).
