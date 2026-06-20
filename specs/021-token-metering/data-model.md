# Data Model: Per-user token metering & quotas

## `token_usage` — migration `010_token_usage.sql` (+ `011` adds the cache column)

One row per metered chat turn.

| Column                | Type | Notes |
|-----------------------|------|-------|
| `id`                  | TEXT PK | UUID |
| `user_id`             | TEXT NOT NULL | app `users.id` |
| `session_id`          | TEXT | the chat session, if any |
| `model`               | TEXT | resolved model id |
| `input_tokens`        | INTEGER NOT NULL DEFAULT 0 | prompt tokens |
| `output_tokens`       | INTEGER NOT NULL DEFAULT 0 | completion tokens |
| `total_tokens`        | INTEGER NOT NULL DEFAULT 0 | provider total (≈ input+output) |
| `cached_input_tokens` | INTEGER NOT NULL DEFAULT 0 | cache-hit input (subset of input); migration 011 |
| `created_at`          | TEXT NOT NULL | ISO |

Index: `idx_token_usage_user (user_id, created_at)`.

## `users` columns — migration `010`

| Column           | Type | Notes |
|------------------|------|-------|
| `token_limit`    | INTEGER | per-user quota override; NULL = use platform default; `0` = unlimited |
| `usage_reset_at` | TEXT | start of the current counting window; NULL = all time |

## `platform_settings` `toggles` keys (spec 019 k/v store; runtime, admin-editable)

| Key                 | Type | Notes |
|---------------------|------|-------|
| `defaultTokenLimit` | int ≥ 0 | platform default quota; `0`/unset = unlimited (set to 5,000,000) |
| `cachedTokenWeight` | 0–1 | cache-hit weight; unset = 0.1 |
| `maxOutputTokens`   | int > 0 | max tokens per answer; unset = 4096 |

## Derived (pure, `chat/quota.ts`)

- `effectiveLimit(userLimit, defaultLimit)` → per-user override (incl. 0) → default → 0.
- `billableTokens(total, cached, weight=0.1)` → `round(total − (1 − weight)·min(cached, total))`.
- `quotaView(used, limit)` → `{ used, limit, remaining (null = unlimited), exceeded }`.

Aggregation (`TokenUsageRepo`): `usageForUser(userId, resetAt)` and `summaryByUser()` sum
total/input/output/cached for `created_at ≥ COALESCE(usage_reset_at, '')`; the admin view joins tier
+ per-user limit; the billable total + effective limit are computed at read time.
