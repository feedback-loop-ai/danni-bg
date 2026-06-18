---
description: "Task list for 018-agentic-evals (retrospective — all shipped)"
---

# Tasks: Agentic quality evals + grounding completeness/transparency

**Input**: Design documents from `/specs/018-agentic-evals/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Status**: Implemented — every task below is `[X]` (shipped in PR #37 on `main`; full `bun:test` suite green, lint + typecheck clean). Paths are real.

**Tests**: TypeScript behaviour is covered by `bun:test` (per the 100%-coverage gate) and listed inline. The Python eval is offline on-demand tooling (Constitution VI), excluded from the coverage gate.

**Organization**: Grouped by the three prioritised user stories (one responsibility: measure and harden grounded-chat faithfulness) plus the configuration setup.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: independent (different file, no dependency)
- **[Story]**: US1–US3 or SETUP

---

## Setup — Configurable LLMs + isolated offline eval project (PR #37)

**Goal**: An isolated `uv`/DeepEval project with every LLM configurable; secrets out of the repo.

- [X] S001 [SETUP] Scaffold `eval/agentic/` as a `uv` project — `eval/agentic/pyproject.toml` (deepeval, openai, httpx, python-dotenv, pytest)
- [X] S002 [SETUP] Configurable subject + judge via env with fallback to `EXPLORER_DEFAULT_*` — `eval/agentic/config.py`
- [X] S003 [SETUP] `bun run eval:agentic` wrapper — `package.json`
- [X] S004 [SETUP] Gitignore the eval venv/caches/`.env` and operational `_*.log` files; commit `.env.example` — `.gitignore`, `eval/agentic/.env.example`
- [X] S005 [SETUP] Skip the suite cleanly when the chat API is unreachable — `eval/agentic/conftest.py`

**Checkpoint**: `bun run eval:agentic` runs against a live API or skips with an actionable message; no secret is committed.

---

## Phase US1 — Offline agentic eval grades the real chat (Priority: P1) 🎯 MVP (PR #37)

**Goal**: Grade the real chat on faithfulness/anti-fabrication, tool correctness, and refusal calibration.

**Independent Test**: `bun run eval:agentic` exercises the case set across the three axes and reports per-case pass/fail; skips when the API is down.

- [X] T101 [US1] SSE client that drives the real `/api/chat` and parses a `ChatResult` (text, tools, citations, error) — `eval/agentic/chat_client.py`
- [X] T102 [US1] Configurable judge (`DeepEvalBaseLLM`) via `response_format` json_schema→json_object + retry/lenient extraction (NOT `guided_json`) — `eval/agentic/judge.py`
- [X] T103 [US1] Metrics: `Faithfulness` / `RefusalQuality` G-Eval with explicit `evaluation_steps`; deterministic `tool_correctness_metric` — `eval/agentic/metrics.py`
- [X] T104 [US1] Thin-slice case set across grounded / nodata / fabrication / antifab — `eval/agentic/cases.py`
- [X] T105 [US1] The pytest suite: deterministic invariants (no-data string, fabricated-id exclusion) + judged metrics; per-case dispatch by kind — `eval/agentic/test_agentic.py`
- [X] T106 [US1] On-failure `xfail` for `known_model_fabrication` cases so the suite stays green across models — `eval/agentic/test_agentic.py`, `cases.py`

**Checkpoint**: With gemma, pancharevo/budget xfail and the rest pass; suite green and deterministic.

---

## Phase US2 — Grounding transparency (Priority: P2) (PR #37)

**Goal**: Surface the EXACT injected context so faithfulness is judged against what the model saw.

**Independent Test**: `debug:true` emits a `grounding` event with the injected text; without `debug`, none.

- [X] T201 [US2] Add `ChatTurnResult.groundingText` (`string | undefined`) — `apps/explorer-api/src/chat/run.ts`
- [X] T202 [US2] Capture tool RESULTS in `runToolLoop` (bounded by the grounding char budget) and combine with the focus block into `groundingText` — `apps/explorer-api/src/chat/run.ts`
- [X] T203 [US2] Add an optional `debug` field to `chatRequestSchema` (Zod, `.strict()`) — `apps/explorer-api/src/routes/chat.ts`
- [X] T204 [US2] Emit a `grounding` SSE event before `citations`, ONLY when `debug && result.groundingText` — `apps/explorer-api/src/routes/chat.ts`
- [X] T205 [US2] Eval: request `debug:true`, parse the `grounding` event into `ChatResult.grounding_text`, and judge faithfulness against it (fallback: reconstruct from cited datasets' records + a bounded row sample, capped at `_MAX_CONTEXT_DATASETS`) — `eval/agentic/chat_client.py`, `test_agentic.py`
- [X] T206 [US2] Test: `debug:true` emits a `grounding` event carrying the injected text (the no-`debug` branch is covered by the existing groundingDatasetIds test) — `apps/explorer-api/tests/chat-route.test.ts`

**Checkpoint**: Faithfulness verdicts are judged against the exact context; the earlier 42-citation false positive is eliminated.

---

## Phase US3 — RAG-path grounding completeness (Priority: P3) (PR #37)

**Goal**: The no-tools fallback grounds in real rows, not titles, so it can't fabricate values.

**Independent Test**: Force the RAG fallback with a candidate that has rows; assert the model prompt contains the real row values + column names.

- [X] T301 [US3] Add `RAG_GROUNDING_DATASETS` (3) and a `RAG_GROUNDING_HEADER` (no `readResource` hint; forbids inventing values; instructs no-data when the sample lacks the answer) — `apps/explorer-api/src/chat/run.ts`
- [X] T302 [US3] In `runRagTurn`, build grounding via `buildFocusContext` over `[explicit focus, …top-N candidates]` (deduped) and inject it in place of the titles-only block; set `groundingText` — `apps/explorer-api/src/chat/run.ts`
- [X] T303 [US3] Test: the RAG fallback injects a candidate's real row values + `Колони:` into the model prompt (capturing MockLanguageModelV3) — `apps/explorer-api/tests/chat-rag.test.ts`

**Checkpoint**: Given only a title before, the model now sees real rows; the real Панчарево record reaches it (verified live).

---

## Dependencies & Execution Order

- **Setup** is independent; required to run the eval at all.
- **US1 (P1)** is the MVP: the eval that grades the real chat.
- **US2 (P2)** makes US1's faithfulness trustworthy (judge against the exact injected context); the eval consumes the new `grounding` event.
- **US3 (P3)** is the concrete grounding fix US1 surfaced; verified by US1/US2.

### Within each story

- TypeScript chat changes (run.ts/chat.ts) are covered by `bun:test`; the Python eval is offline tooling.
- The eval's transparency consumption (T205) depends on the chat emitting the `grounding` event (T201–T204).

## Notes

- **Model finding (acted on):** `gemma-4-26b-uncensored` fabricates despite correct grounding; `deepseek-v4-pro` grounds faithfully (only `air-quality` borderline). v4-pro was promoted to the live chat default via `.env` (runtime config, not committed). Tracked-xfail cases auto-surface when a model/guardrail improves.
- **Constitution VI:** the eval is intentionally outside the `bun:test` gate (live-LLM, network-bound, minutes-long); the hermetic `grounding-benchmark.test.ts` remains the per-PR enforcement check.
- **Secrets:** subject/judge config (incl. the DeepSeek key) lives only in gitignored `.env` files; `.env.example` documents the variables.
