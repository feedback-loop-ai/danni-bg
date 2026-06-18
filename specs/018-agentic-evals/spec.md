# Feature Specification: Agentic quality evals + grounding completeness/transparency

**Feature Branch**: `018-agentic-evals`  
**Created**: 2026-06-18  
**Status**: Implemented (eval suite + RAG row-injection & tool-result transparency shipped in PR #37 on `main`; verified by the full `bun:test` suite green and by live `bun run eval:agentic` runs against the LAN gemma and DeepSeek)  
**Input**: Retrospective spec for already-merged work that adds an offline agentic quality eval for the grounded chat and closes the grounding gaps it surfaced (RAG path grounded on titles only; no way to see the exact context a turn injected).

## Clarifications

### Session 2026-06-18

- Q: Why can't the existing `grounding-benchmark.test.ts` answer "does the model fabricate?" → A: It drives the real grounding loop with a **mocked** model (Constitution VI keeps the `bun:test` suite hermetic and <5s). It proves the *enforcement layer* drops fabricated citations; it cannot grade a *real* model's behaviour. That requires a live-LLM, non-deterministic, judged eval — which MUST live outside the unit gate (R1).
- Q: Which quality axes matter for this chat? → A: Three — faithfulness/anti-fabrication (claims traceable to grounded rows), tool correctness (right mirror tool/args), and refusal calibration (honest "no relevant data" vs improvisation). Retrieval recall@K is already covered by `danni eval` (R2).
- Q: How can a faithfulness judge fairly assess an answer without seeing what the model was grounded on? → A: It can't — judging against reconstructed/partial context produces false positives. The chat must surface the EXACT injected context (a `grounding` event, opt-in via `debug:true`); the eval judges against that (R3).
- Q: Why did a grounded question still get fabricated answers on the no-tools path? → A: `runRagTurn` (the fallback for providers without tool-calling — what self-hosted gemma hits) fed the model dataset **titles only**; rows were injected solely for explicitly focused datasets. Given a title, the model invented row-level specifics. The fix injects sampled rows for the top retrieved candidates too (R4).
- Q: How is a tool-calling model judged, since its grounding is the tool *results*, not a focus block? → A: Capture the tool results the model received in `runToolLoop` and include them in `groundingText`. Otherwise the judge is starved of context and false-flags real retrieved datasets as fabrication (R5).
- Q: gemma keeps fabricating even with correct grounding — is that a grounding bug? → A: No. With the real rows present (verified), `gemma-4-26b-uncensored` still fabricated; `deepseek-v4-pro` did not. It is a MODEL/guardrail issue, tracked as on-failure xfail so the suite stays green across models and auto-surfaces when fixed (R6).
- Q: Should the judge be the same self-hosted model as the subject? → A: Configurable, but defaulting the judge to the subject is circular. Keep the judge independently repointable (`EVAL_JUDGE_*`); when the live default became DeepSeek, the eval judge was pinned to the LAN gemma so it stays independent and free (R7).

## User Scenarios & Testing *(mandatory)*

This feature has one responsibility: **measure (and harden) whether the grounded chat answers faithfully.** It is delivered as three prioritised, independently testable slices plus a configuration setup.

### User Story 1 - Offline agentic eval grades the real chat (Priority: P1)

A maintainer runs `bun run eval:agentic` against the running chat API and gets a per-axis pass/fail report — faithfulness/anti-fabrication, tool correctness, refusal calibration — driven by the *real* model, judged by a configurable LLM. It runs on demand (not in CI), and skips cleanly when the API is down.

**Why this priority**: The original "Панчарево kindergartens" fabrication proved unit tests can't catch the failure that matters most — a confident model inventing public-data contents. This eval is the only thing that grades real-model behaviour. P1 because every other slice exists to make this measurement trustworthy or to act on what it finds.

**Independent Test**: With the API up, `bun run eval:agentic` exercises a set of cases across the three axes and reports results; with the API down it skips with an actionable message rather than erroring.

**Acceptance Scenarios**:

1. **Given** the chat API is running, **When** `bun run eval:agentic` runs, **Then** each case drives the real `/api/chat` over SSE and is graded on faithfulness, tool correctness, and/or refusal calibration.
2. **Given** the chat API is not reachable, **When** the suite runs, **Then** it skips every case with a clear "start the API" message (not a stack trace).
3. **Given** a known no-data question, **When** graded, **Then** an honest "no relevant data" answer passes and a fabricated one fails (refusal calibration).
4. **Given** a fabricated dataset id in a question, **When** graded, **Then** the answer must not present it as real and must not carry it as a citation.

---

### User Story 2 - Grounding transparency: judge against the exact injected context (Priority: P2)

The chat can surface the precise grounding text it injected for a turn — focus/RAG rows on the no-tools path, and the captured tool results on the tool-loop path — emitted as an opt-in `grounding` SSE event. The eval judges faithfulness against that exact context.

**Why this priority**: A faithfulness verdict is only as good as the context the judge sees. Reconstructing it (titles, sampled rows) under-represents what a tool-calling model actually retrieved and produces false positives (e.g. flagging 34 of 42 genuinely-retrieved datasets as "fabricated"). P2 because it makes P1's faithfulness scores trustworthy.

**Independent Test**: Post a chat request with `debug:true`; assert a `grounding` event carries the injected context. Without `debug`, assert no such event is emitted.

**Acceptance Scenarios**:

1. **Given** a request with `debug:true` and a grounded dataset, **When** the turn completes, **Then** a `grounding` SSE event carries the exact injected text.
2. **Given** a request without `debug`, **When** the turn completes, **Then** no `grounding` event is emitted (default clients are unaffected).
3. **Given** a tool-calling model that read datasets via tools, **When** `debug:true`, **Then** the grounding text includes the captured tool results (what the model actually saw), bounded by the grounding char budget.
4. **Given** the eval has the grounding event, **When** it grades faithfulness, **Then** it judges against that exact context (not a reconstruction).

---

### User Story 3 - RAG-path grounding completeness (inject real rows, not titles) (Priority: P3)

On the no-tools fallback path (`runRagTurn`), the chat grounds answers in a bounded sample of the top retrieved candidates' real rows — not just their titles — so it answers from data instead of inventing values, and is told to say "no data" when the sample lacks the answer.

**Why this priority**: This is the concrete grounding defect the eval surfaced: given only a title like "Детски градини София-град", the model fabricated specific kindergartens. P3 because it depends on the existing focus-context mechanism (017) and is verified by P1's eval / P2's transparency.

**Independent Test**: Drive `runRagTurn` (force the tool-choice-unsupported fallback) with a candidate that has rows; assert the model's prompt contains the real row values and column names, not just the title.

**Acceptance Scenarios**:

1. **Given** the no-tools fallback and a retrieved candidate with rows, **When** a turn runs, **Then** a bounded sample of that candidate's rows (and column names) is injected into the model prompt.
2. **Given** the injected sample does not contain the asked-for value, **When** the model answers, **Then** the RAG grounding header instructs it to say there is no such data rather than invent it.
3. **Given** many retrieved candidates, **When** rows are injected, **Then** only the top N (RAG_GROUNDING_DATASETS) are row-injected and the whole block stays within the grounding char budget; the rest remain listed by title.

---

### Setup - Configurable LLMs + isolated offline tooling (folds into PR #37)

The eval is an isolated Python/`uv`/DeepEval project under `eval/agentic/`, invoked via `bun run eval:agentic`. Every LLM is configurable via `EVAL_*` env: the **subject** (the chat model under test) defaults to the repo's `EXPLORER_DEFAULT_*`; the **judge** is independently repointable (and was pinned to the LAN gemma once the live default became DeepSeek, to stay independent and free). Secrets live only in gitignored env files. The judge constrains its output via `response_format` (`json_schema`→`json_object`), because vLLM `guided_json` via `extra_body` is silently ignored by some servers.

### Edge Cases

- **API down**: the suite skips (not errors) with an actionable message.
- **Local judge emits non-JSON**: `response_format` constrains it; a retry + lenient extraction backstops; `guided_json` is NOT relied upon.
- **Tool-calling model cites dozens of datasets**: tool results are captured as grounding (full context); context reconstruction (fallback) is capped to avoid judge-context overflow.
- **Model fabricates despite correct grounding**: tracked as on-failure xfail (`known_model_fabrication`) — the suite stays green and the case auto-surfaces (xpass→pass) when a better model/guardrail fixes it.
- **Judge circularity**: the judge defaults to (and can be pinned to) a model independent of the subject.
- **No grounding produced (debug:true)**: no `grounding` event is emitted (the field is empty) — not an error.

## Requirements *(mandatory)*

### Functional Requirements

(Continues the explorer chat FR series from features 008/017; FR-016/FR-018/FR-024 are referenced from those.)

- **FR-045**: An offline agentic eval suite MUST grade the real chat (over `/api/chat` SSE) on faithfulness/anti-fabrication, tool correctness, and refusal calibration. It MUST run OUTSIDE the `bun:test` gate (Constitution VI: hermetic, <5s, no live network) as a separate `uv`/DeepEval project invoked on demand via `bun run eval:agentic`, and MUST skip cleanly when the API is unreachable.
- **FR-046**: All LLMs MUST be configurable via env — the SUBJECT (`EVAL_SUBJECT_*`, the chat model under test, sent explicitly per request) and the JUDGE (`EVAL_JUDGE_*`, the LLM-as-judge) — each defaulting to the repo `EXPLORER_DEFAULT_*` but independently repointable. Secrets MUST come from gitignored env only and MUST NOT be committed or logged.
- **FR-047**: The judge MUST obtain schema-valid output via `response_format` (`json_schema`, falling back to `json_object`); it MUST NOT rely on vLLM `guided_json` via `extra_body` (silently ignored by some servers). A bounded retry + lenient JSON extraction MUST backstop occasional malformed output.
- **FR-048**: The chat MUST be able to surface the EXACT grounding context injected into the model for a turn via `ChatTurnResult.groundingText` — the focus/RAG row block on the no-tools path AND the captured tool RESULTS on the tool-loop path — emitted as a `grounding` SSE event ONLY when the request sets `debug:true`. It MUST be bounded by the existing grounding character budget and MUST NOT change default (non-debug) responses.
- **FR-049**: The no-tools RAG fallback (`runRagTurn`) MUST ground answers in real rows: pre-read a bounded sample of the top `RAG_GROUNDING_DATASETS` retrieved candidates' rows (not titles only), exposing column names, with a RAG-specific header that forbids inventing values and instructs an explicit no-data reply when the sample lacks the answer. The whole block MUST stay within the grounding char budget.
- **FR-050**: Faithfulness MUST be judged against the exact injected grounding (the `grounding` event) when available, falling back to reconstructing context from cited datasets' records + a bounded row sample; the reconstruction MUST cap the number of datasets to avoid judge-context overflow.
- **FR-051**: Cases where the model fabricates despite correct grounding MUST be tracked as on-failure `xfail` (`known_model_fabrication`) so the suite stays green across models and auto-surfaces (xpass) when a model/guardrail fixes the behaviour. Deterministic invariants (no-data string, fabricated-id exclusion, tool choice) remain hard assertions.

### Key Entities *(include if feature involves data)*

- **Eval case** (`eval/agentic/cases.py`): `{ id, kind (grounded|nodata|fabrication|antifab), question, expect_tool?, known_model_fabrication }`. Drives one real chat turn.
- **ChatResult** (eval client): the parsed SSE outcome — answer text, tools called, citations, the exact `grounding_text` (when `debug`), session id, error.
- **Configurable provider** (`EVAL_SUBJECT_*` / `EVAL_JUDGE_*` → `ProviderCfg`): `{ kind, model, base_url, api_key }` for subject and judge, resolved with fallback to `EXPLORER_DEFAULT_*`.
- **`ChatTurnResult.groundingText`**: the exact injected grounding for a turn (focus/RAG rows + captured tool results), surfaced only on `debug`.
- **Metric** (DeepEval): `Faithfulness`/`RefusalQuality` (G-Eval, judge-graded) and `ToolCorrectness` (deterministic), with explicit `evaluation_steps` so the judge skips a fragile generate-the-steps round-trip.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `bun run eval:agentic` drives the real chat across the three axes and reports per-case pass/fail; with the API down it skips with a clear message (no stack trace).
- **SC-002**: Subject and judge models are independently configurable via env; the judge can be pinned to a different endpoint than the subject (was: gemma judging DeepSeek). No secret appears in the repo or logs.
- **SC-003**: The RAG fallback injects a retrieved candidate's real row values + column names into the model prompt (verified by a unit test), bounded by the grounding char budget — not titles only.
- **SC-004**: With `debug:true` the chat emits a `grounding` event carrying the exact injected text; without `debug` no such event is emitted (both branches covered by tests).
- **SC-005**: Faithfulness is judged against the exact injected grounding; a true fabrication (pancharevo under gemma) is detected, and a faithful grounded answer passes — with the verdict not an artifact of context starvation.
- **SC-006**: A model comparison is recorded — `gemma-4-26b-uncensored` fabricates despite correct grounding; `deepseek-v4-pro` grounds faithfully — and informs the live default (promoted to v4-pro via `.env`).
- **SC-007**: All TypeScript additions are 100% covered (RAG row injection via `chat-rag.test.ts`; the `debug`→`grounding` emission via `chat-route.test.ts`); the offline Python eval is excluded from the coverage gate as non-source offline tooling (it is not an MCP tool or portal endpoint and is not run by `bun:test`).
- **SC-008**: The full `bun:test` suite passes; lint and typecheck are clean (pre-commit gate green at #37).

## Assumptions

- **Measurement, not a CI gate**: the agentic eval is non-deterministic, network-bound, and LLM-graded, so it deliberately runs outside the `bun:test` inner-loop gate (Constitution VI). It complements — does not replace — the hermetic `grounding-benchmark.test.ts`.
- **The model is the residual lever**: grounding is correct by construction (rows injected, tool results captured); whether the model *uses* it faithfully is a model/guardrail property. `gemma-4-26b-uncensored` fabricates; `deepseek-v4-pro` does not (with `air-quality` borderline on UUID misattribution/verbosity).
- **Judge reliability**: a local judge needs `response_format` to emit schema-valid JSON; `guided_json` via `extra_body` is silently ignored by the spark vLLM. Using one model to judge itself is circular — keep the judge independently configurable.
- **Live default promotion is runtime config**: pointing the chat at `deepseek-v4-pro` is an `.env` change (gitignored), not source; reproducibility for others belongs in `.env.example` rather than a committed key.
- **Builds on 008/017**: reuses the explorer chat (008), the four mirror tools, the SSE contract, and the focus-context grounding mechanism (017, `buildFocusContext`, `GROUNDING_TOTAL_CHARS`).
