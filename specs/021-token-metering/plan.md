# Implementation Plan: Per-user token metering & quotas

**Status**: Implemented (retrospective). PR #53 (metering + enforcement + admin/self views), PR #54
(input/output/cache breakdown), PR #55 (admin-configurable default limit + cache weight; default set
to 5,000,000 at runtime), PR #57 (admin-configurable max output tokens).

## Architecture

- **Recording.** Each chat turn's usage is read from the AI SDK `streamText` result (`totalUsage`,
  incl. `cachedInputTokens`) in `run.ts` (`ChatTurnResult.usage`) and recorded by the chat route
  against the signed-in user via `TokenUsageRepo.record` (`src/store/repos/token-usage.ts`).
- **Quota math** is a pure module (`apps/explorer-api/src/chat/quota.ts`): `effectiveLimit`
  (per-user override → platform default → unlimited), `billableTokens(total, cached, weight)` =
  `total − (1 − weight)·cached` (cache hits discounted; `CACHE_WEIGHT = 0.1`), and `quotaView`
  (used/limit/remaining/exceeded). Shared by the chat gate, the admin overview, and the self view.
- **Enforcement.** The chat route computes billable usage since the user's `usage_reset_at` and, if
  over the effective limit, returns 429 `quota_exceeded` before resolving the model. The SPA surfaces
  it as a Bulgarian message.
- **Windowing.** Usage is summed from `usage_reset_at` (NULL = all time); an admin reset bumps that
  timestamp, so a "reset" restarts the counter without deleting history.
- **Runtime config.** `defaultTokenLimit`, `cachedTokenWeight`, `maxOutputTokens` live in the
  `platform_settings` `toggles` blob (spec 019), resolved per request in `app.ts` and threaded into
  the chat handler / me + admin routes — so an admin edit on the Платформа page applies without a
  restart.

## Endpoints

- `GET /api/admin/usage` — per-user table (usage joined with tier + effective limit + breakdown).
- `PUT /api/admin/users/:id/limit` ({ limit: number|null }) / `POST /api/admin/users/:id/reset`.
- `GET /api/me/usage` — the caller's billable usage + breakdown + effective quota.
- `PUT /api/admin/settings` toggles gain `defaultTokenLimit` / `cachedTokenWeight` / `maxOutputTokens`.
- `POST /api/chat` → 429 `quota_exceeded` when over quota.

## UI

- Admin Платформа page (`SettingsPage` + `AdminUsage`): default-limit / cache-weight / max-output
  fields + a per-user usage table with inline limit edit + reset.
- User settings (`SelfUsage`): "Употреба на токени" — billable used vs limit + input/output/cache.
- Chat surfaces the 429 as a friendly Bulgarian quota message.

## Phases (as delivered)

- **#53** — migration 010 (`token_usage` + `users.token_limit`/`usage_reset_at`); `TokenUsageRepo`;
  `quota.ts`; usage capture + record + 429 gate; admin/me endpoints; admin table + self section.
- **#54** — migration 011 (`token_usage.cached_input_tokens`); capture + sum + surface the
  input/output/cache breakdown.
- **#55** — `cachedTokenWeight` toggle + `billableTokens` weighting; admin-configurable default limit
  (set to 5,000,000 at runtime, not hardcoded).
- **#57** — `maxOutputTokens` toggle (default 4096) threaded into the turn.

## Decisions

- **Measure + enforce** (not measure-only) and **admin + self** visibility — chosen by the user.
- **Cache at 10%, configurable** — cache hits are far cheaper; weight is a platform setting so policy
  is admin-controlled rather than hardcoded.
- **Default 5,000,000, admin-set** — configured via the setting, not baked into code.
- **Reset = bump timestamp** — keeps history; avoids deleting usage rows.

## Testing

Hermetic (`bun:test`, no live network — Constitution VI): `quota.test.ts` (effectiveLimit / quotaView
/ billableTokens incl. weighting), `token-usage.test.ts` (windowed totals, breakdown, reset),
`usage-routes.test.ts` (admin table + masked-nothing, PUT/limit, reset, `/me/usage`, configurable
weight, and the `/api/chat` 429 gate). Live: verified on `:8790` (admin fields read 5000000 / 0.1;
breakdown renders; over-quota → 429).
