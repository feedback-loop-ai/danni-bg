# Data Model: Agentic eval hardening

No database changes — the eval is an external client. The "model" here is the eval's own config + case
shape.

## `Case` dataclass (`eval/agentic/cases.py`)

The existing eval case, extended:

| Field | Type | Notes |
|---|---|---|
| `id` / `kind` / `question` | str | unchanged (kind ∈ grounded \| nodata \| fabrication \| antifab) |
| `expect_tool` | `str \| None` | soft tool-correctness expectation |
| `note` | str | rationale |
| `known_model_fabrication` | bool | grounding-correct-but-model-fabricates → xfail (suite stays green) |
| `enum` | bool | **new** — broad enumeration topic (count-inflation / ghost-id load) |
| `scope` | `dict \| None` | **new** — chat scope sent with the turn, e.g. `{"geoUnitIds":[…]}` |

## Config seams (env, resolved in `config.py`)

| Prefix | Purpose |
|---|---|
| `EVAL_SUBJECT_*` | the chat model under test (kind/model/baseUrl/apiKey), sent per request |
| `EVAL_JUDGE_*` | the LLM-as-judge (repoint to Qwen 3.7 Plus on Model Studio); secrets in gitignored `.env` |
| `EVAL_AUTH_EMAIL` / `EVAL_AUTH_PASSWORD` | **new** — override the throwaway identity (log in vs register) |
| `EVAL_API_BASE_URL` | the running chat to grade (default `http://localhost:8790`) |

Resolution order (unchanged): `eval/.env` override > repo-root `.env` > built-in default.

## Guard inputs (`guards.py`)

Pure function over what the turn produced — no DB, no LLM:

- **answer text** — the streamed reply.
- **injected grounding** — the exact context the server injected (from the `debug:true` `grounding`
  SSE event).

Derived checks: dataset UUIDs in the answer ⊆ UUIDs in the grounding; any "над N / over N datasets"
claim ≤ count of grounded datasets.
