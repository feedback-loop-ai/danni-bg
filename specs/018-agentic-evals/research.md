# Research: Agentic quality evals + grounding completeness/transparency

## R1 — Why an offline eval at all (the gap the mocked benchmark leaves)

`apps/explorer-api/tests/grounding-benchmark.test.ts` drives the real grounding loop with a **scripted/mock** model: it proves the enforcement layer *drops* fabricated citations, deterministically, in-process, under the `bun:test` gate. By design (Constitution VI: hermetic, <5s, no live network) it cannot grade a *real* model's prose. The "Панчарево kindergartens" fabrication is exactly that uncovered failure mode. **Decision**: add a separate, on-demand, live-LLM, LLM-judged eval that drives the real `/api/chat` over HTTP — and keep it out of the inner-loop/CI gate.

## R2 — Framework choice: DeepEval (over Ragas)

The chat's risk profile is *agentic* (anti-fabrication, tool-use, refusal calibration), not pure-RAG. **DeepEval** is a test framework ("pytest for LLMs") with first-class tool-correctness, custom G-Eval rubrics, and a custom-model seam — it fits a pass/fail gate driven by our own endpoints. **Ragas** is a strong RAG *metrics* library (context precision/recall, synthetic test generation) but agentic support is thinner and it's not a test harness; retrieval recall@K is already covered by `danni eval`. **Decision**: DeepEval as the harness; borrow Ragas-style synthetic generation later if the case set needs to scale. No SaaS (gov data stays local); both subject and judge are configurable endpoints.

## R3 — Judge over the real chat via HTTP, judged against the exact grounding

The system-under-test is the real `runChatTurn` as the browser sees it, so the eval drives `/api/chat` over SSE rather than importing TS in-process. A faithfulness judge must see **what the model saw**; reconstructing context (titles, sampled rows) under-represents a tool-calling model's actual retrieval and yields false positives (observed: 34 of 42 genuinely-retrieved datasets flagged as "fabricated"). **Decision**: the chat surfaces the exact injected context via an opt-in `grounding` event (`debug:true`); the eval judges against it, with a capped reconstruction only as fallback.

## R4 — The titles-only RAG grounding gap

`runRagTurn` (the fallback for providers without tool-calling — what self-hosted gemma hits, since spark vLLM isn't started with `--enable-auto-tool-choice`) fed the model dataset **titles only**; rows were injected solely for explicitly *focused* datasets (017). Given a title like "Детски градини София-град", the model invented specific kindergartens. **Decision**: pre-read a bounded sample of the top `RAG_GROUNDING_DATASETS` (3) retrieved candidates' rows via `buildFocusContext`, with a RAG-specific header that forbids inventing values and instructs an explicit no-data reply. Verified: the real Панчарево record then reaches the model.

## R5 — Capturing tool results as grounding (tool-loop path)

For a tool-calling model the grounding *is* the tool results, not a focus block. Without capturing them, the judge is starved and false-flags real datasets. **Decision**: accumulate `tool-result` payloads in `runToolLoop` (bounded by `GROUNDING_TOTAL_CHARS`) and combine with any focus block into `groundingText`.

## R6 — `response_format`, not `guided_json`

The spark vLLM (`gemma-4-26b-uncensored`) **silently ignores** `extra_body={"guided_json": …}` — it returns free prose, which broke G-Eval's JSON scoring intermittently. `response_format={"type":"json_schema"|"json_object"}` IS honoured. **Decision**: the judge uses `response_format` (json_schema → json_object fallback) + a bounded retry and lenient extraction. Also: supply G-Eval `evaluation_steps` explicitly so it skips a fragile generate-the-steps round-trip. (Recorded for reuse: [[spark-vllm-structured-output]].)

## R7 — Model comparison (the residual lever is the model)

Subject grading with an independent gemma judge throughout:

| Subject | Result |
|---|---|
| `gemma-4-26b-uncensored` | fabricates despite correct grounding (pancharevo always, budget intermittently) |
| `deepseek-chat` (V3) | worse — also fabricates varna |
| `deepseek-v4-pro` | grounds faithfully — pancharevo/budget/varna pass; only `air-quality` borderline (UUID misattribution + listing technical IDs) |

**Decision**: grounding is correct by construction; the residual is a model/guardrail property. Promote `deepseek-v4-pro` to the live default (`.env`, runtime config). Track fabrication-prone cases as on-failure `xfail` so the suite is model-agnostic and auto-surfaces improvement. Keep the judge independently configurable (pinned to LAN gemma once the default became DeepSeek) to avoid circularity and judge-side billing.
