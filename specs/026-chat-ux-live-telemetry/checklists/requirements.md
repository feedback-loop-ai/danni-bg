# Requirements checklist

Retrospective verification for spec 026 (all items met on `main`).

## Functional

- [x] FR-111 — Favicon (`public/favicon.svg`, path-based) linked in `index.html` + `theme-color`.
  *(live: `/favicon.svg` → 200 image/svg+xml)*
- [x] FR-112 — Claude-style typing indicator (dots breathing out of phase) replaces the static `…`.
  *(headless: indicator shown while waiting, incl. tool-calling phase)*
- [x] FR-113 — `usage` SSE event: cumulative per step + final authoritative; through
  GenerationManager (forward + resume-snapshot replay) → sendChat → UI; billing unchanged.
  *(live: events ↑1189→55151 / ↓111→2496 + cached)*
- [x] FR-114 — Per-turn tokens + duration persisted per message (migration 014) + restored on
  reload/resume. *(API round-trip: usage {↑1293,↓55,cache1280} + durationMs 1638; sessions-repo test)*
- [x] FR-115 — One `UsageFooter`, identical live (↑/↓/⚡ + ticking ⏱ + pulsing dot) and after
  completion; separate meter removed. *(headless: ⏱ ticks 0→3.5s; completed footer identical)*

## Success criteria

- [x] SC-012 — favicon served; typing indicator while waiting.
- [x] SC-013 — live usage streams (UI ↑0→10801 / ↓0→318; ⏱ 0→0.5→…→3.5 s).
- [x] SC-014 — tokens + duration kept (footer identical after reload; API persists usage + durationMs).
- [x] SC-015 — 183 api + 71 web tests pass (incl. persistence round-trip); tsc + biome + build clean.

## Quality gates

- [x] Additive only (new SSE event + nullable columns); no REST shape break; metering untouched.
- [x] One shared `UsageFooter`; billing reads the same `readUsage`.
- [x] CI `build-test` green on PRs #77/#78/#80/#82.

## Deploy note

- [ ] Apply migration 014 with `bun run db:migrate` on deploy (server does not auto-migrate; the
  assistant-message append fails until `usage_json`/`duration_ms` exist).
