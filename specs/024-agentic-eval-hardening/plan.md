# Implementation Plan: Agentic eval hardening

**Spec**: [spec.md](./spec.md) · **Status**: Implemented (retrospective for PRs #63/#64/#65/#70 + the
eval parts of #71). Extends spec 018. Stack unchanged: Python + `uv` + DeepEval in `eval/agentic`,
driving the real Hono chat over HTTP; graded by a configurable LLM-as-judge. Stays OUTSIDE the locked
`bun:test` hermetic gate (Constitution VI).

## Architecture

Four independent seams, each added without changing the chat under test.

### 1. Auth against the gated chat (`chat_client.py` — PR #63)

- `POST /api/chat` requires a Kratos session (spec 019). The client lazily builds one cookie-jar
  `httpx.Client`: GET the browser **registration** flow through the single-port `/kratos` proxy,
  submit `{csrf_token, method:"password", traits.email, password}` → Kratos auto-creates the identity
  and runs the session hook.
- **Workaround:** httpx's cookie jar didn't reliably re-send the `ory_kratos_session` set via the
  proxy, so after registration the client pins it as an explicit `Cookie` header
  (`c.headers["cookie"] = "ory_kratos_session=…"`) and clears the jar. Every chat + dataset request
  then carries it.
- `EVAL_AUTH_EMAIL` / `EVAL_AUTH_PASSWORD` switch from a throwaway user to an existing account (e.g.
  an admin or a higher-quota user) by logging in instead of registering.

### 2. Judge-independent deterministic guards (`guards.py` — PR #64)

- Pure `expand`-free checks over `(answer_text, injected_grounding)`:
  - **ghost ids** — every dataset UUID stated in the answer must appear in the grounding payload.
  - **count inflation** — a "над N набора" / "over N datasets" claim must not exceed the number of
    datasets grounded. Regex is clause-bounded so "над 24 часа" / "над 40 г." don't false-trigger.
- Wired as `test_grounding_invariants` (runs per case, no LLM). Catches the chat's real,
  intermittent failure mode mechanically — a weak judge can neither miss nor over-flag it.

### 3. Frontier judge, no code change (`config.py`/`judge.py` + `.env` — PR #64)

- `ConfigurableJudge` already speaks OpenAI-compatible. Alibaba **Model Studio** (DashScope) is
  OpenAI-compatible, so the frontier judge **Qwen 3.7 Plus** needs only `EVAL_JUDGE_*` repointed
  (base `…/compatible-mode/v1`, model `qwen3.7-plus`); `judge_structured` falls back json_schema →
  json_object, which the endpoint accepts. The key lives only in the gitignored `.env`;
  `.env.example` documents the Qwen block and flags gemma as the offline-LAN alternative.
- **Finding:** the local `gemma-4-26b` is an unreliable judge on long enumerations (can't track a
  16–32K-char grounding context; false-flags grounded datasets). Hand-adjudication against the exact
  injected grounding, then the frontier judge, both confirmed the answers were faithful.

### 4. Expanded case set (`cases.py` + `test_agentic.py` — PRs #65, #70)

- `Case` gained `enum: bool` (broad topics from the largest facet buckets — registers, municipalities,
  a second oblast, ПУП, NSI demographics) and `scope: dict | None` (sent as `scope.geoUnitIds`,
  exercising spec-023 roll-up + recall + in-region faithfulness). The `case_run` fixture passes
  `scope=case.scope`.

## Testing / verification

- Live `bun run eval:agentic` against `:8790` with the identity stack up.
- **Judge comparison** that motivated the frontier switch: on the 11-case set the gemma judge gave
  9 pass / 2 fail / 1 xfail (false fabrication flags on air-quality + varna-geo), while Qwen 3.7 Plus
  gave 33/33 — matching hand-adjudication.
- Deterministic guards verified offline: clean on faithful generations; flag a synthetic ghost-id and
  a synthetic count inflation; no false positive on "над 24 часа" / "над 40 г.".
- Full 13-case run (after the geo cases) under Qwen: 38 passed, the lone finding being the
  cross-region fabrication later fixed in spec 023 (FR-101), after which the case passes outright.

## Risks / tradeoffs

- Non-determinism: borderline cases can flip pass/xfail run-to-run; `known_model_fabrication` keeps the
  suite green while surfacing the case.
- DashScope keys are region-bound and may be unreachable off certain networks → gemma stays as the
  documented fallback (less trustworthy, but free + LAN-local).
- Throwaway accounts share the default token quota; override the identity for very large runs.
