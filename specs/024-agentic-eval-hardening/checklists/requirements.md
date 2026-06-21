# Requirements checklist

Retrospective verification for spec 024 (all items met on `main`).

## Functional

- [x] FR-102 — Eval authenticates against the gated chat (throwaway-user registration via `/kratos`
  proxy; session pinned as explicit `Cookie` header; `EVAL_AUTH_*` override). *(no 401s; PR #63)*
- [x] FR-103 — Judge-independent deterministic guards (`guards.py` / `test_grounding_invariants`):
  no ghost dataset id, no count inflation. *(offline-verified; PR #64)*
- [x] FR-104 — Frontier judge repointable (Qwen 3.7 Plus on Model Studio, OpenAI-compatible, no code
  change); gemma documented unreliable; secrets only in gitignored `.env`. *(PR #64)*
- [x] FR-105 — Enumeration cases with an `enum` flag from the largest facet buckets. *(PR #65)*
- [x] FR-106 — Geo-scoped cases (`scope` field → `scope.geoUnitIds`) exercising roll-up, recall, and
  in-region faithfulness. *(PRs #70/#71)*

## Success criteria

- [x] SC-007 — Live `bun run eval:agentic` grades the gated chat end-to-end (13 cases × 3 tests,
  authenticated, no 401s).
- [x] SC-008 — Guards flag a synthetic ghost-id and a synthetic count inflation, pass clean
  generations, no false positive on "над 24 часа" / "над 40 г." — all with no LLM call.
- [x] SC-009 — Frontier verdicts match hand-adjudication: gemma's false fabrication flags
  (air-quality, varna-geo) pass under Qwen 3.7 Plus (gemma 9pass/2fail/1xfail → Qwen 33/33 on the
  11-case set).
- [x] SC-010 — Geo-scoped cases pass: municipality-under-oblast-scope grounds; recall retrieves the
  region and stays in-region (after spec 023 FR-100/FR-101).

## Quality gates

- [x] Pure guard logic is deterministic + offline; no new DB/server surface.
- [x] Live-LLM eval stays outside the locked `bun:test` hermetic gate (Constitution VI), as in 018.
- [x] Judge/subject/auth secrets confined to the gitignored `eval/agentic/.env`.

## Evidence (this session)

- gemma judge (11 cases): 9 passed / 2 failed / 1 xfailed — the 2 failures (air-quality 0.60,
  varna-geo 0.40) were false fabrication flags, refuted by hand-adjudication against the injected
  grounding.
- Qwen 3.7 Plus judge: 33/33 (11 cases), then 38 passed on the 13-case run (the lone finding being the
  cross-region fabrication fixed in spec 023 FR-101, after which it passes outright).
