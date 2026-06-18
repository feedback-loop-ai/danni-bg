# Quickstart: Agentic quality evals

## Run the eval

```bash
bun run explorer:api      # system-under-test must be up (port 8790)
bun run eval:agentic      # or, from eval/agentic: uv run pytest
```

If the API is down the suite **skips** with an actionable message (not an error). First run creates the `uv` venv and installs DeepEval/openai/httpx.

## Configure the models (all optional; gitignored)

Defaults inherit the repo-root `.env` (`EXPLORER_DEFAULT_*`). To override, copy `eval/agentic/.env.example` → `eval/agentic/.env`:

- **Subject** (the chat model under test): `EVAL_SUBJECT_KIND/MODEL/BASE_URL/API_KEY`.
- **Judge** (LLM-as-judge): `EVAL_JUDGE_*`. Pin it to a model independent of the subject (e.g. LAN gemma judging DeepSeek) to avoid circularity. `EVAL_JUDGE_STRUCTURED=1` uses `response_format=json_schema` (vLLM `guided_json` is ignored by some servers).
- `EVAL_API_BASE_URL` — the chat API (default `http://localhost:8790`).

## What it grades

- **Deterministic**: no-data answers match the exact reply and cite nothing; fabricated ids never reach citations; grounded answers cite ≥1 dataset.
- **Tool correctness**: the right mirror tool was called.
- **Judged (G-Eval)**: faithfulness (claims traceable to the exact injected grounding) and refusal quality (honest "no data" vs improvisation).

## Reading results

- `passed` — the case met its bar.
- `xfailed` — a `known_model_fabrication` case failed as expected (grounding correct, model fabricates). The suite stays green; it auto-flips to `xpassed`/`passed` when a better model/guardrail fixes it.
- `failed` — a real, untracked regression.

## Inspecting what the model was grounded on

Add `"debug": true` to a `/api/chat` request to receive a `grounding` SSE event with the exact injected context (the eval uses this to judge faithfulness fairly).

## Current standing finding

`gemma-4-26b-uncensored` fabricates despite correct grounding; `deepseek-v4-pro` grounds faithfully and is the promoted live default (`.env`). Only `air-quality` is borderline under v4-pro (UUID misattribution / listing technical IDs).
