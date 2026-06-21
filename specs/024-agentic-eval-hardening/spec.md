# Feature Specification: Agentic eval hardening (auth, frontier judge, guards, expanded cases)

**Feature Branch**: `024-agentic-eval-hardening`
**Created**: 2026-06-21
**Status**: Implemented (PRs #63 auth, #64 guards + frontier-judge config, #65 enumeration cases,
#70 geo-scoped cases, and the eval parts of #71 on `main`; verified by live `bun run eval:agentic`
runs against the gated chat with the Qwen 3.7 Plus judge).
**Input**: "run the agentic evals against the new chat" — which, after the identity (spec 019) and
geo (spec 023) work, required hardening the spec-018 eval: it could no longer reach the now-gated
chat, the local judge proved untrustworthy on long answers, and the case set didn't cover the new
geo-scope behavior.

## Overview

Spec 018 introduced the offline agentic eval (`eval/agentic`, DeepEval over the real chat). Since
then the chat became **auth-gated** (spec 019) and **metered** (spec 021), and gained **geo-scope
roll-up + recall** (spec 023). Running the eval "against the new chat" surfaced four gaps, each fixed
here:

1. **It couldn't authenticate.** `POST /api/chat` now 401s without a Kratos session, so every case
   errored.
2. **The judge was untrustworthy.** The local `gemma-4-26b` judge false-flagged faithful
   long-enumeration answers as "fabricated"; its verdicts didn't survive hand-adjudication against the
   exact injected grounding.
3. **Anti-fabrication leaned entirely on that judge.** There was no judge-independent check for the
   concrete failure modes (invented dataset ids, inflated counts).
4. **The case set was thin and geo-blind.** Six cases, none enumerating at scale and none exercising a
   geo-scope.

## Clarifications

### Session 2026-06-20/21

- Q: How does the eval reach the gated chat? → A: it **self-registers a throwaway user** via the
  single-port `/kratos` proxy and authenticates every request. httpx's cookie jar didn't reliably
  re-send the proxied `ory_kratos_session`, so the session token is pinned as an explicit `Cookie`
  header. `EVAL_AUTH_EMAIL` / `EVAL_AUTH_PASSWORD` override to grade under a specific account.
- Q: Is gemma a good judge? → A: **No** for long enumerations — it can't track a 16–32K-char grounding
  context and false-flags grounded datasets. Hand-adjudication (and later the frontier judge) agreed
  the answers were faithful. Use a **frontier judge**.
- Q: Which frontier judge? → A: **Qwen 3.7 Plus** on Alibaba **Model Studio** (DashScope), which is
  OpenAI-compatible — so the existing `ConfigurableJudge` needs no code change, just `EVAL_JUDGE_*`
  repointed. The key lives only in the gitignored `eval/agentic/.env`.
- Q: How to not depend on any LLM judge for the core invariants? → A: **deterministic guards**
  (`guards.py`): every dataset id in the answer must be in the grounding (no ghost ids), and a
  "над N набора"/"over N datasets" claim must not exceed the number grounded (no count inflation).
- Q: What new cases? → A: **enumeration** cases from the largest facet buckets (registers ~4000,
  municipalities ~3300, ПУП ~160, a second oblast, NSI demographics) and **geo-scoped** cases that
  drive `scope.geoUnitIds` (roll-up + recall + in-region faithfulness, spec 023).

## User Scenarios & Testing *(mandatory)*

One responsibility: **the agentic eval grades the real, gated, geo-aware chat trustworthily.**

### User Story 1 — The eval runs against the gated chat (Priority: P1)

A maintainer runs `bun run eval:agentic` against a running `:8790` (identity stack up). The eval
authenticates itself and grades every case; it does not 401.

**Acceptance**
1. The eval registers/logs in and sends an authenticated `POST /api/chat` per case.
2. With no server it still **skips** cleanly (preserved from 018), not errors.

### User Story 2 — Verdicts are trustworthy (Priority: P1)

A maintainer trusts a red/green result. The faithfulness judge is frontier-class; the core
anti-fabrication invariants don't depend on the judge at all.

**Acceptance**
1. The judge endpoint is configurable to a frontier model (Qwen via Model Studio) with no code change.
2. Deterministic guards fail a case that states a ghost dataset id or inflates a dataset count,
   regardless of the judge.
3. The local gemma judge is documented as unreliable for long enumerations.

### User Story 3 — Coverage of scale and geo (Priority: P2)

The case set exercises long enumerations and the geo-scope behaviors shipped in spec 023.

**Acceptance**
1. Enumeration cases retrieve many datasets and are graded for faithfulness + the guards.
2. Geo-scoped cases drive `scope.geoUnitIds`: an oblast scope grounds on a municipality question
   (roll-up), a generic query under a tight scope retrieves the region (recall), and the answer stays
   in-region (no cross-region fabrication).

### Edge Cases
- A throwaway account hits the default token quota → not a concern at this case volume; override via
  `EVAL_AUTH_EMAIL` to a higher-limit user if needed.
- The frontier judge endpoint is region-bound (DashScope keys per region) and may be unreachable from
  some networks → the gemma config stays in `.env.example` as the offline-LAN alternative.
- Subject non-determinism: a borderline case may pass one run and xfail another; tracked cases use
  `known_model_fabrication` so the suite stays green either way.

## Requirements *(mandatory)*

- **FR-102**: The eval MUST authenticate against the gated chat — self-register a throwaway user via
  the single-port `/kratos` proxy and send a valid session on every request — pinning the session as
  an explicit `Cookie` header (the proxied jar cookie isn't reliably re-sent). `EVAL_AUTH_EMAIL` /
  `EVAL_AUTH_PASSWORD` MUST override the identity.
- **FR-103**: The eval MUST include judge-independent deterministic guards (`guards.py`,
  `test_grounding_invariants`): no dataset id stated in the answer may be absent from the grounding,
  and no "над N / over N datasets" claim may exceed the number of datasets grounded.
- **FR-104**: The faithfulness judge MUST be repointable to a frontier OpenAI-compatible endpoint
  (Qwen 3.7 Plus via Alibaba Model Studio) with no code change; the local gemma-26b MUST be documented
  as unreliable for long enumerations. Judge secrets live only in the gitignored `.env`.
- **FR-105**: The case set MUST include enumeration cases (broad topics from the largest facet
  buckets) carrying an `enum` flag, graded for faithfulness and the guards.
- **FR-106**: The case set MUST include geo-scoped cases (a `scope` field on `Case` → `scope.geoUnitIds`)
  exercising the spec-023 chat behaviors: oblast→municipality roll-up, scope-aware recall, and
  in-region faithfulness.

## Success Criteria *(mandatory)*

- **SC-007**: `bun run eval:agentic` grades the live gated chat end-to-end (verified: 13 cases × 3
  tests run authenticated; no 401s).
- **SC-008**: The deterministic guards flag a synthetic ghost-id and a synthetic count inflation, and
  pass clean faithful generations — with no LLM call.
- **SC-009**: The frontier judge's verdicts match hand-adjudication where gemma false-failed: the
  cases gemma scored as fabrication (air-quality, varna-geo) pass under Qwen 3.7 Plus.
- **SC-010**: The geo-scoped cases pass: the municipality-under-oblast-scope case grounds correctly,
  and the recall case retrieves the region and stays in-region (after spec 023 FR-100/FR-101).

## Out of scope
- Changing the locked `bun:test` hermetic gate — this live-LLM eval stays outside it (Constitution VI,
  as in 018).
- Synthetic case generation (Ragas) and a scheduled nightly run — still future work from 018.
