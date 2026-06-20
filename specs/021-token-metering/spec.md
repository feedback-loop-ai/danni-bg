# Feature Specification: Per-user token metering & quotas

**Feature Branch**: `021-token-metering`
**Created**: 2026-06-20
**Status**: Implemented (shipped in PRs #53, #54, and the metering parts of #55, plus the configurable
max-output of #57, on `main`; verified by the full suite green + live runs on `:8790`)
**Input**: Retrospective spec for already-merged work. Chat bills the configured LLM per token, so the
platform needs per-user accounting + enforced limits, with admins managing limits and users seeing
their own usage. Builds on spec 019 (gated chat, tiered users, admin platform settings).

## Clarifications

### Session 2026-06-19/20

- Q: Measure only, or enforce? → A: **Measure + enforce.** Record per-user token usage AND enforce a
  per-user quota; an over-quota user is blocked (HTTP 429) before any model work.
- Q: Who sees usage? → A: **Admin sees everyone; each user sees their own.** Admins get a per-user
  table; users get a self view.
- Q: What's the effective limit for a user? → A: per-user override (`users.token_limit`) wins —
  including an explicit `0` = unlimited — else the platform default, else unlimited.
- Q: How are cheap cache hits counted? → A: **Cache-hit input tokens count at a configurable weight
  (default 0.1).** Billable = `total − (1 − weight)·cached`. The raw input/output/cache breakdown is
  still recorded + shown; the billable total is what the quota uses.
- Q: Is the default limit hardcoded? → A: **No — admin-configurable** (`toggles.defaultTokenLimit`),
  set to **5,000,000** at runtime via that setting. The cache weight and the max-output cap are
  admin-configurable too (`toggles.cachedTokenWeight`, `toggles.maxOutputTokens`).
- Q: What does an admin "reset" do? → A: It bumps the user's `usage_reset_at`; usage is counted from
  that timestamp, so history is retained (not deleted) and the counter restarts.
- Q: Why a max-output-tokens cap at all? → A: it protects the self-hosted vLLM path (an explicit
  positive `max_tokens` avoids the "0 output tokens" error on large prompts), bounds cost/latency,
  and guards runaway generation. Default 4096, admin-configurable.
- Q: Where do token counts come from? → A: the provider's reported usage (AI SDK `totalUsage`,
  including `cachedInputTokens`); a provider that omits a field records 0.

## User Scenarios & Testing *(mandatory)*

One responsibility: **account for and cap each user's LLM token consumption, visible to admins and to
the user.**

### User Story 1 — Metering + self view (Priority: P1)

Each chat turn records the user's token usage (input / output / total + cache hits). The user sees
their own usage and effective quota in their settings (a small progress + breakdown).

**Acceptance**: ask → `GET /api/me/usage` reflects the turn (billable total + input/output/cache
breakdown); the settings "Употреба на токени" section shows it.

### User Story 2 — Enforcement (Priority: P1)

A user at or over their effective limit cannot chat: the request is rejected with 429
`quota_exceeded` before any model call; the UI surfaces a Bulgarian "quota reached" message.

### User Story 3 — Admin management (Priority: P1)

An admin sees every user's usage (email, role, used/limit, input/output/cache, requests), can set or
clear a user's limit, and can reset a user's counter. The platform default limit, cache weight, and
max-output cap are editable on the Платформа page and apply without a restart.

### Edge Cases

- Per-user `token_limit = 0` → unlimited for that user (overrides a non-zero default).
- A provider that doesn't report `cachedInputTokens` → cache counts as 0 (billable == total).
- Reset mid-period → only usage at/after the new `usage_reset_at` counts.
- A non-admin calling `/api/admin/usage` → 403; anon → 401.

## Requirements *(mandatory)*

- **FR-074**: Each chat turn's token usage (input, output, total, cache-hit input) MUST be recorded
  against the signed-in user.
- **FR-075**: A user whose billable usage is at/over their effective limit MUST be rejected with 429
  `quota_exceeded` BEFORE any model work.
- **FR-076**: The effective limit MUST be the per-user override (incl. `0` = unlimited) else the
  platform default else unlimited.
- **FR-077**: Cache-hit input tokens MUST count toward the quota at a configurable weight (default
  0.1): billable = `total − (1 − weight)·cached`; the raw breakdown is preserved.
- **FR-078**: An admin MUST be able to view per-user usage (with breakdown), set/clear a user's
  limit, and reset a user's counter; these endpoints MUST be admin-only.
- **FR-079**: A user MUST be able to view their own usage + effective quota.
- **FR-080**: The platform default token limit, cache weight, and max output tokens MUST be
  admin-configurable at runtime (no redeploy).
- **FR-081**: Usage MUST be counted since the user's `usage_reset_at`; a reset bumps that timestamp
  (history retained, not deleted).
- **FR-082**: Token counts MUST come from the provider's reported usage; an omitted field records 0.

## Success Criteria *(mandatory)*

- **SC-001**: A completed turn increments the user's usage; `/api/me/usage` reflects the billable
  total + input/output/cache breakdown.
- **SC-002**: A user at/over the limit gets 429 and no model call is made.
- **SC-003**: A given turn with cache hits is counted at the configured weight (billable < raw total).
- **SC-004**: An admin sets a limit / resets a counter and the change applies without a restart.
- **SC-005**: `/api/admin/*` usage endpoints are admin-only (403 for users, 401 for anon).
- **SC-006**: Covered by hermetic tests (quota math, the usage repo, and the admin/me/chat-gate
  routes incl. the 429), suite green.

## Key Entities

- **token_usage** — one row per metered turn (user_id, session_id, model, input/output/total +
  cached_input tokens, created_at).
- **users.token_limit / users.usage_reset_at** — per-user quota override + the start of the current
  counting window.
- **platform_settings toggles** — `defaultTokenLimit`, `cachedTokenWeight`, `maxOutputTokens`
  (runtime, admin-editable).
