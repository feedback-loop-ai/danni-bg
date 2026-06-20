# Tasks: Per-user token metering & quotas

Retrospective — all delivered. #53 metering+enforcement+views; #54 breakdown; #55 configurable
policy; #57 configurable max-output.

## Metering + enforcement (PR #53)

- [X] T001 [DATA] migration 010 — `token_usage` + `users.token_limit`/`usage_reset_at`.
- [X] T002 [REPO] `TokenUsageRepo` (record / usageForUser since reset / summaryByUser);
  `UsersRepo.setTokenLimit` + `resetUsage`.
- [X] T003 [CORE] `chat/quota.ts` — `effectiveLimit` / `quotaView`.
- [X] T004 [CHAT] capture `streamText` usage → `ChatTurnResult.usage`; record per user; 429 gate.
- [X] T005 [API] `GET /api/admin/usage`, `PUT /users/:id/limit`, `POST /users/:id/reset`,
  `GET /api/me/usage`.
- [X] T006 [WEB] admin usage table (`AdminUsage`) + default-limit field; self section (`SelfUsage`);
  chat 429 message.
- [X] T007 [TEST] `quota.test.ts`, `token-usage.test.ts`, `usage-routes.test.ts`.

## Breakdown (PR #54)

- [X] T008 [DATA] migration 011 — `token_usage.cached_input_tokens`.
- [X] T009 capture `cachedInputTokens`; sum input/output/cached; surface in `/me/usage`,
  `/admin/usage`, and both UIs.

## Configurable policy (PR #55) + max-output (PR #57)

- [X] T010 `cachedTokenWeight` toggle + `billableTokens` weighting (cache at 10%); admin field.
- [X] T011 admin-configurable `defaultTokenLimit` (set to 5,000,000 at runtime, not hardcoded).
- [X] T012 `maxOutputTokens` toggle (default 4096) threaded into the turn; admin field.

## Verification

- [X] Hermetic tests green (quota math, repo, routes incl. 429 + configurable weight).
- [X] Live on `:8790`: admin fields read 5000000 / 0.1; breakdown renders; over-quota → 429.
