# Requirements Quality Checklist: Agentic quality evals + grounding completeness/transparency

**Purpose**: Validate that the spec for 018-agentic-evals is complete, unambiguous, testable, and traceable before sign-off.
**Created**: 2026-06-18
**Feature**: [spec.md](../spec.md)

## The eval (the core responsibility)

- [X] CHK001 The spec states the eval grades the REAL chat on faithfulness/anti-fabrication, tool correctness, and refusal calibration (FR-045, US1)
- [X] CHK002 It is explicit that the eval runs OUTSIDE the `bun:test` gate (Constitution VI) as an on-demand `uv`/DeepEval project (`bun run eval:agentic`) (FR-045, plan VI)
- [X] CHK003 The clean-skip-when-API-down behaviour is specified and testable (FR-045, US1 scenario 2, SC-001)
- [X] CHK004 The relationship to the hermetic `grounding-benchmark.test.ts` (enforcement vs real-model) is stated (Clarifications Q1, Assumptions)

## Configurable LLMs & judge reliability

- [X] CHK005 Subject and judge are independently configurable via env, with fallback to `EXPLORER_DEFAULT_*` (FR-046, SC-002)
- [X] CHK006 Judge circularity is addressed (independently repointable; pinned to LAN gemma when default is DeepSeek) (FR-046, Clarifications Q7)
- [X] CHK007 The judge output is constrained via `response_format` (NOT `guided_json`), with retry/extraction backstop (FR-047, research R6)
- [X] CHK008 Secret handling (gitignored env only, never committed/logged) is specified and consistent with FR-024 (FR-046, Setup)

## Grounding transparency

- [X] CHK009 `ChatTurnResult.groundingText` captures the exact injected context on BOTH paths (focus/RAG rows + tool results) (FR-048, data-model)
- [X] CHK010 The `grounding` SSE event is opt-in (`debug:true`) and leaves default responses unchanged (FR-048, contracts/http-api.md, SC-004)
- [X] CHK011 The eval judges faithfulness against the exact grounding, with a bounded reconstruction fallback (FR-050, US2 scenario 4)
- [X] CHK012 The context-starvation false-positive motivation is explained (tool-calling model, 42 citations) (Clarifications Q5, research R3/R5)

## RAG-path grounding completeness

- [X] CHK013 The titles-only RAG gap and the fix (inject top-N candidates' real rows + columns) are specified (FR-049, US3, research R4)
- [X] CHK014 Injection is bounded (RAG_GROUNDING_DATASETS=3, 90k char budget) and instructs a no-data reply when the sample lacks the answer (FR-049, US3 scenario 3)

## Quality, testability & honesty

- [X] CHK015 Every FR (FR-045…FR-051) is specific and verifiable; none contain `NEEDS CLARIFICATION` or unresolved placeholders
- [X] CHK016 Success criteria SC-001…SC-008 are measurable (skip-when-down, row-injection unit test, debug-event both branches, model comparison recorded)
- [X] CHK017 User stories are prioritised P1–P3 with Why / Independent Test / Given-When-Then acceptance scenarios
- [X] CHK018 Key Entities cover the eval Case, ChatResult, ProviderCfg, `groundingText`, and the metric set
- [X] CHK019 Edge cases cover API-down, malformed judge JSON, many-citation tool models, model-fabrication-despite-grounding, judge circularity, empty grounding
- [X] CHK020 The model finding is stated plainly (gemma fabricates; v4-pro faithful; promoted via `.env`) and tracked as on-failure xfail (Assumptions, FR-051, SC-006)
- [X] CHK021 The Constitution VIII coverage stance is explicit and honest: TS additions covered by `bun:test`; the offline Python eval excluded as offline tooling (plan VIII + Complexity Tracking, SC-007)
- [X] CHK022 Constitution alignment is cited precisely (VI fast-feedback central; I/III/V/VII/VIII/IX/X; FR-016/FR-018/FR-024)

## Notes

- All items pass: this checklist validates a retrospective spec for shipped, merged work (PR #37).
- FR numbering continues the explorer chat series — features 008 (…FR-032) and 017 (FR-033…FR-044); this feature adds FR-045…FR-051.
- The TypeScript behaviour is covered by `bun:test`; the Python eval is on-demand offline tooling per Constitution VI.
