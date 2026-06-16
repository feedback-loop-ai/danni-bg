# Research: Trustworthy grounded chat

**Feature**: 017-grounded-chat · **Status**: Implemented (PRs #22/#26/#27/#28/#29)

Decisions below are retrospective — they record why the shipped design is what it is.

## R1. Grounding-by-construction beats prompt-only anti-fabrication

**Decision**: Pre-read the focused dataset's actual rows and inject them into the model's context as a labelled "ДАННИ (ground truth)" block, on BOTH the tool-loop and the RAG fallback. Always cite the focused dataset. Treat the hardened system prompt as reinforcement, not the primary guarantee.

**Why**: The original design relied on two things that both failed for focused datasets:
1. `scope.datasetIds` only *scoped which datasets the tools could read* — it never told the model which dataset was focused, nor showed it any rows. So the model either asked "which register?" or, pushed by the user, confabulated specifics (the Ихтиман register: 16 identical invented clubs + a non-existent ЕИК, vs. 10 real distinct clubs).
2. The RAG fallback was worse — it fed the model only dataset **titles**, never any row data, so a "what's in it" question had nothing to answer from.

A pure system-prompt fix ("never invent values") cannot work when the model has *no* values in front of it; it just makes the model refuse or hedge. Injecting the real rows makes a faithful answer the path of least resistance and an unfaithful one detectable (every cited value must appear verbatim in the block). The prompt hardening (FR-035) closes the remaining gap: never state a value not present verbatim; never fabricate to agree with the user.

**Verified (live)**: re-running the exact scoped query on gemma listed the 10 real clubs with their real ЕИКs (matching the grid) and noted the empty rows. No fabrication.

**Alternatives rejected**: (a) prompt-only — cannot ground what the model can't see; (b) force a `readResource` call before answering — the tool-shy model often skips it, and the RAG path has no tools at all; injection works regardless.

## R2. Injection vs. tool scope — and the injection vs. value-filter trade-off

**Decision**: Keep *row injection* and *tool scope* as two distinct signals. `scope.datasetIds` is a hard focus that both injects rows and narrows what tools may read. A new `groundingDatasetIds` injects rows WITHOUT narrowing tool scope. For exact/exhaustive value questions, prefer a data-layer **value-filter** over having the model scan the injected sample.

**Why distinct signals**: Auto-focusing the open reader must not stop the model from searching beyond that dataset for a follow-up. Conflating the two would either over-narrow (the model can't look anything else up) or under-ground (no rows injected). Splitting them lets a follow-up stay grounded in the reader's dataset while the tools remain free.

**Injection vs. value-filter trade-off**:
- *Injection* (US1–US3) is cheap, always-on, and works without the model calling anything — but it is a **bounded sample**. For a large dataset or an exhaustive question ("ALL kindergartens in район Панчарево"), the relevant rows may not all be in the sample, and asking the model to enumerate matches from the sample is unreliable (it misses rows).
- *Value-filter* (US4) pushes selection to the data layer: `readResource` with `filters` scans the whole resource (up to the grid cap) and returns ONLY matching rows — exact, complete, and independent of the injection budget, so it also works on datasets too big to inject. The cost is that it requires the model to actually call the tool with the right column name.

The two compose: injection guarantees a grounded answer; the value-filter (when called) makes it exhaustive. The focus block therefore also exposes each resource's exact column names + `resourceId` so the model can target a filter precisely.

## R3. Sticky session grounding + bounded history window

**Decision**: The session remembers what the conversation is "about" (`contextDatasetIds`: the explicit/reader focus if given, else whatever the last answer cited, capped at 2) and re-injects those rows every turn. Separately, replay only a recent window of the transcript (`windowMessages`: a message-count + char budget, always keeping the last message).

**Why sticky context**: History plumbing was already correct (sessionId round-trips, transcript persisted in-session + replayed), but the focused dataset's **rows** were injected only on the turn it was focused. A follow-up then relied on the weak model recalling the previous answer's *prose* — it frequently just asked "which dataset?" instead of continuing. Re-injecting the grounding rows every turn fixes this. The grounding rows are the durable state; the prose transcript is not.

**Why a window, not the full transcript**: Replaying the full transcript every turn is unbounded → context-overflow risk on long chats. Because the grounding rows live in the **system prompt** (not the replayed transcript), trimming old turns is safe — the conversation stays grounded even when its early turns are dropped. The window keeps the most recent messages within `MAX_HISTORY_MESSAGES` (10) and `MAX_HISTORY_CHARS` (24,000), newest-first, always retaining the last message.

**Verified (live)**: unfocused "дай ми всички спортни клубове в Ихтиман" → "какви спортове има?" now answers from the real clubs (Футбол, Бокс, Биатлон, Лека атлетика, Ръгби, Културизъм) instead of asking for clarification.

## R4. The район / sub-municipal recall gap

**Problem**: "детски градини в Панчарево" returned **no data**, although the data clearly contains them. Панчарево is a Sofia **район** — sub-municipal, not a gazetteer entity — and it appears only as a **value** in the rows of one София-град-wide dataset. The search index covers metadata, column names, and place **entities**, not row **values**. So blind search (mirrorSearch/mirrorEntitySearch) can never reach a район that exists only as a cell value.

**Resolution**: Two complementary reaches that don't depend on the index:
1. **Grounding** (auto-focus the open reader) injects the dataset's actual rows, so район Панчарево rows are in front of the model. This required raising the per-resource fetch from 50 to **1000** rows — 50 was far too few for a 569-row dataset, so район Панчарево rows were never in the sample — under a **90k-char total budget** so the prompt can't overflow.
2. **Value-filter** (`readResource` + `filters`) selects район Панчарево rows at the data layer regardless of sample size.

**Verified (live)**: with the София-град schools/kindergartens dataset focused, the chat now lists район Панчарево kindergartens (ЧДГ „Слънчогледи", ДГ №143 „Щурче", …) instead of "no data".

## R5. Bounding injected context so the system prompt can't overflow

**Decision**: Fetch up to `FOCUS_ROWS` = 1000 rows per resource, but cap the *whole* injected block at `GROUNDING_TOTAL_CHARS` = 90,000 across all grounded datasets/resources, decrementing a running budget per resource and passing the remaining budget into `capResourceContent`. Flag any truncated sample as "частична извадка".

**Why**: A generous row fetch is needed for район-level recall, but a large dataset's raw JSON (e.g. ~180k chars) would blow the context window. A total char budget (not a per-resource one) keeps the system prompt bounded no matter how many resources/datasets are grounded, while still surfacing as much real data as fits. Truncation is flagged so the model knows the sample is partial and can fall back to the value-filter.

## R6. Provider configuration & secret handling (setup)

**Decision**: Configure the chat's default provider via `EXPLORER_DEFAULT_*` env vars; commit a `.env.example`; gitignore `.env`/`.env.local`; document that the endpoint must support tool/function calling. No code change.

**Why**: `/api/chat` returned "no server default provider is configured" because no default LLM was set. Bun auto-loads a repo-root `.env` for `bun run`, so a documented, copyable `.env.example` is the simplest fix. Per FR-024, user-supplied credentials are sent per request and never persisted/logged server-side; the server-default key resides only in server configuration. Because the chat agent uses tools (the four mirror wrappers), the configured endpoint must support tool/function calling — a vLLM started with `--enable-auto-tool-choice` (or Anthropic); otherwise the RAG fallback path is used.

## R7. Model-faithfulness caveat (honest limitation)

The grounding mechanism is **robust by construction** — the answer is grounded and cited whether or not the model calls a tool, and every cited value is present verbatim in the injected rows. However, the self-hosted `gemma-4-26b-uncensored` model used in development is **tool-shy and weak/sycophantic**: it sometimes enumerates an injected sample **incompletely** (e.g. listed 2 of ~9 район Панчарево kindergartens) and does **not reliably call** the value-filter even though the capability and the column names are handed to it. Consequences:
- **Exact/exhaustive completeness depends on a more faithful model.** The data is fully available to the model either way; a faithful model would use the filter and enumerate exhaustively.
- **Grounding is never compromised by the weak model** — it cannot fabricate values not present, and the focused dataset is always cited.

This is stated plainly so consumers do not over-trust enumeration completeness from the development model; it is a model limitation, not a defect of the grounding design. Swapping in a more faithful tool-calling model is a configuration change (R6), not a redesign.
