# Tasks: Agentic eval hardening

Retrospective task list (all complete). Grouped by the PR that landed them.

## Phase 1 — Auth against the gated chat (PR #63)

- [x] T001 `chat_client.py`: lazy cookie-jar client that self-registers a throwaway user via the
  single-port `/kratos` registration flow; pin `ory_kratos_session` as an explicit `Cookie` header
  (the proxied jar cookie isn't reliably re-sent). — FR-102
- [x] T002 `EVAL_AUTH_EMAIL` / `EVAL_AUTH_PASSWORD` override (log in to an existing account instead of
  registering). — FR-102
- [x] T003 Verify: the suite reaches the gated chat (no 401s); still skips cleanly when the API is down.

## Phase 2 — Deterministic guards + frontier judge (PR #64)

- [x] T004 `guards.py`: pure `expandGeoUnitIds`-free checks — no ghost dataset id, no inflated count;
  clause-bounded regex avoids "над 24 часа" / "над 40 г." false positives. — FR-103
- [x] T005 Wire `test_grounding_invariants` (per case, no LLM). — FR-103
- [x] T006 Document + enable a frontier judge: Qwen 3.7 Plus on Model Studio via `EVAL_JUDGE_*`
  (OpenAI-compatible → no code change); `.env.example` Qwen block; gemma flagged unreliable. — FR-104
- [x] T007 Verify: gemma 9pass/2fail/1xfail vs Qwen 33/33 on the 11-case set; guards catch synthetic
  ghost-id + count inflation offline.

## Phase 3 — Enumeration cases (PR #65)

- [x] T008 `cases.py`: `enum` flag + 5 enumeration cases (registers, municipalities, oblast Пловдив,
  ПУП, NSI demographics) from the largest facet buckets; validated against `bridge.search`. — FR-105

## Phase 4 — Geo-scoped cases (PR #70)

- [x] T009 `cases.py`: `scope` field on `Case`; `case_run` passes `scope=case.scope`. — FR-106
- [x] T010 Add `geo-scope-municipality-rollup` (oblast scope, municipality question → roll-up) and
  `geo-scope-recall` (generic query under a tight scope → recall). — FR-106

## Phase 5 — In-region faithfulness (eval parts of PR #71)

- [x] T011 After the spec-023 `GEO_SCOPE_NOTE` guardrail (FR-101), `geo-scope-recall` asserts
  faithfulness outright (removed `known_model_fabrication`); verified pass under the Qwen judge. — FR-106

## Notes
- No DB / server changes; the eval is an external client. Stays outside the `bun:test` gate.
- Future work (from 018): synthetic case generation (Ragas) + a scheduled nightly run.
