# Feature Specification: Trustworthy grounded chat (anti-fabrication, sticky context, auto-focus, value-filter)

**Feature Branch**: `017-grounded-chat`  
**Created**: 2026-06-16  
**Status**: Implemented (shipped in PRs #22, #26, #27, #28, #29 on `main`; verified by the test suite — 1004 pass — and by live runs against the LAN vLLM)  
**Input**: Retrospective spec for already-merged work hardening the explorer chat so it answers strictly from real mirror data and never fabricates dataset contents.

## Clarifications

### Session 2026-06-16

- Q: Does scoping a dataset (`scope.datasetIds`) make the model see its rows? → A: No. Scoping only *restricts which datasets the tools may read*; the model was never told which dataset was in focus nor shown its rows, so it confabulated. Grounding is a separate, additive signal: the backend pre-reads the focused dataset and injects its rows as a "ДАННИ (ground truth)" context block (R1).
- Q: Should grounding a dataset (e.g. the one open in the reader) also narrow tool scope? → A: No. Row injection and tool scope are deliberately distinct. A new request field `groundingDatasetIds` injects rows WITHOUT restricting what the tools may look up; `scope.datasetIds` is a *hard focus* that both injects and narrows. This lets follow-ups stay grounded while the model can still search beyond the focused dataset (R2).
- Q: How does the conversation stay grounded across turns without persisting transcripts server-side (FR-019)? → A: The session remembers what it is "about" — `contextDatasetIds`: the explicit focus if given, else the datasets the last answer cited, capped at 2 — and re-injects those rows every turn. The transcript is replayed only within a recent-message + char window; the grounding rows live in the system prompt, not the replayed transcript, so trimming old turns is safe (R3).
- Q: Why did "детски градини в Панчарево" return no data when the data clearly contains them? → A: Панчарево is a Sofia *район* (sub-municipal) that is not a gazetteer entity and is not indexed; it appears only as a *value* inside the rows of one София-град-wide dataset. The search index covers metadata, column names and place entities — not row values — so blind search cannot reach it. Grounding (reading the focused dataset's rows) and value-filtering can (R4).
- Q: How are exhaustive value questions ("all kindergartens in район Панчарево") answered exactly when the injected sample is partial or the dataset is too big to inject? → A: `readResource` gained a `filters` arg (exact column name → case-insensitive substring) forwarded to the existing grid query; it scans the whole resource (up to the grid cap) and returns only matching rows. The focus block exposes the resource's column names so the model can target a filter precisely (R5).
- Q: Where does the LLM provider come from, and how are its secrets handled? → A: A server default provider is configured via `EXPLORER_DEFAULT_*` env vars (Bun auto-loads a repo-root `.env`); `.env.example` is committed and `.env` is gitignored. The chat agent uses tools, so the endpoint MUST support tool/function calling. User-supplied credentials are sent per request and never logged/persisted server-side (R6).

## User Scenarios & Testing *(mandatory)*

This feature has one responsibility: **the chat answers from real data and never fabricates.** It is delivered as four prioritised, independently testable slices plus a provider-configuration setup.

### User Story 1 - Answers are grounded in the focused dataset's real rows (Priority: P1)

A user focuses a dataset ("ask about this dataset") and asks what it contains. The chat answers from the dataset's actual rows — real names, codes (ЕИК), and numbers — and never invents contents to satisfy the question. The focused dataset is always cited.

**Why this priority**: This is the headline trust failure the feature exists to fix. Before it, focusing the Ихтиман sports-club register and asking about it produced a wholly fabricated answer (16 identical copies of a club and an ЕИК that do not exist; the real data is 10 distinct clubs). A data assistant that confidently invents public-data contents is worse than no assistant — it is P1 because every other slice builds on grounded-by-construction answers.

**Independent Test**: Focus a dataset whose single resource holds known, distinct rows; ask "what does this dataset contain?"; assert the answer reproduces the real row values (and only those), and that the focused dataset is cited even when the model calls no tools.

**Acceptance Scenarios**:

1. **Given** a focused dataset whose resource has 10 distinct real rows, **When** the user asks what it contains, **Then** the answer lists the real values (and notes the empty rows) and cites the focused dataset — no invented names/codes.
2. **Given** a focused dataset and a (tool-shy) model that calls no tools, **When** a turn runs, **Then** the focused dataset's rows are pre-read and injected as a "ДАННИ (ground truth)" context block, and the dataset is cited.
3. **Given** the retrieval (RAG) fallback path (provider without tool-calling), **When** a focused dataset is in play, **Then** its sampled rows — not just its title — are fed to the model so a "what's in it" question is still answered from data.
4. **Given** a user who pressures the model to confirm a value not present in the rows, **When** the model answers, **Then** it states the value cannot be seen rather than fabricating agreement.

---

### User Story 2 - The conversation stays grounded across turns within a bounded window (Priority: P2)

After the first grounded answer, a follow-up ("what sports do they offer?") continues to answer from the same dataset's rows instead of asking "which dataset?". Long conversations never overflow the model's context.

**Why this priority**: Grounding only the focusing turn is fragile — a follow-up then relies on a weak model recalling the previous answer's prose, and it frequently just asks for clarification. Persisting and replaying the full transcript unbounded risks context overflow on long chats. P2 because it makes P1's grounding durable across a real multi-turn conversation while keeping context bounded.

**Independent Test**: Send an unfocused first message that grounds in and cites dataset D, then a follow-up with no scope and no tool call; assert the follow-up still cites D (fails without sticky context). Separately, build a long transcript and assert only a bounded recent window is replayed.

**Acceptance Scenarios**:

1. **Given** a first turn that cited dataset D, **When** a follow-up arrives with no explicit focus and the model calls no tool, **Then** the session re-injects D's rows and the follow-up still cites D.
2. **Given** an explicit focus on the current turn, **When** the turn completes, **Then** the session's sticky context becomes that focus; otherwise it becomes the datasets the answer cited, deduped and capped at 2.
3. **Given** a transcript longer than the history budget, **When** a turn runs, **Then** only the most recent messages within the message-count and character budget are replayed (always at least the last message), and grounding rows — held in the system prompt — are unaffected.

---

### User Story 3 - The dataset open in the reader is auto-focused for grounding (Priority: P3)

A user has a dataset open in the document reader and asks a row-level / район-level question. The chat grounds the answer in that open dataset's rows automatically, without the user having to "ask about this dataset", and without narrowing what the tools may search.

**Why this priority**: "детски градини в Панчарево" returned no data because Панчарево is a sub-municipal район that exists only as a row value and is not indexed, so blind search cannot reach it. The reader already knows which dataset is open; sending its id as a grounding signal makes such row/район questions answerable. P3 because it depends on P1's grounding mechanism and P2's precedence model, and broadens reach to row-value queries.

**Independent Test**: Send a request with `groundingDatasetIds: [D]` and no `scope.datasetIds`; assert D's rows are injected and D is cited even with no tool call. Assert grounding does not narrow tool scope. Assert a large focused dataset's injected rows stay within the total character budget and are flagged partial.

**Acceptance Scenarios**:

1. **Given** the София-град schools/kindergartens dataset open in the reader, **When** the user asks about район Панчарево kindergartens, **Then** the answer lists real район Панчарево rows instead of "no data".
2. **Given** both an explicit focus and an open reader and prior sticky context, **When** a turn runs, **Then** grounding precedence is: explicit focus > open reader > sticky context.
3. **Given** a focused dataset large enough that raw injection would exceed the budget, **When** rows are injected, **Then** the block is capped at the total character budget (and per-resource fetch is bounded at up to 1000 rows) and flagged as a partial sample.
4. **Given** `groundingDatasetIds`, **When** the turn runs, **Then** rows are injected but the tools remain able to read datasets outside that id (no scope narrowing).

---

### User Story 4 - Exact value-filtering on a resource column (Priority: P4)

For exhaustive value questions ("all kindergartens in район Панчарево"), the chat can ask the data layer for *only* the matching rows — exact and complete — rather than scanning an injected sample.

**Why this priority**: Having the model scan injected rows and enumerate matches is unreliable (it misses rows) and breaks for datasets too big to inject. Pushing selection to the data layer makes exhaustive answers exact and scalable. P4 because it is an enhancement on top of grounding (US1–US3): grounding is correct without it, but exhaustive completeness needs it.

**Independent Test**: Call `readResource` with `filters: { "<col>": "<substring>" }`; assert the filter is forwarded to the grid query and only matching rows are returned. Assert the focus context block lists the resource's exact column keys and `resourceId`.

**Acceptance Scenarios**:

1. **Given** a resource with a `rayon` column, **When** `readResource` is called with `filters: { "rayon": "Панчарево" }`, **Then** the grid query scans the whole resource (up to the cap) and returns ONLY rows whose `rayon` contains "Панчарево" (case-insensitive).
2. **Given** a focused dataset, **When** its rows are injected, **Then** the context block lists the resource's exact column names (`Колони: …`) and `resourceId` so the model can target a filter precisely.
3. **Given** a resource too large to inject within the budget, **When** the user asks an exhaustive value question, **Then** the answer can still be exact because filtering runs at the data layer independent of the injection budget.

---

### Setup - Configure the chat's default LLM provider (folds in PR #22)

The chat (`/api/chat`) returns "no server default provider is configured" unless a default LLM is configured via `EXPLORER_DEFAULT_*` env vars. A committed `.env.example` documents the variables (self-hosted vLLM and Anthropic examples); Bun auto-loads a repo-root `.env`, so copying it is enough. `.env` / `.env.local` are gitignored so real config/secrets are never committed. The chat agent uses tools, so the endpoint MUST support tool/function calling.

### Edge Cases

- **User pressure to fabricate**: the model must say it cannot see a value rather than agreeing with the user; the system prompt forbids stating any value not present verbatim in a tool result or context.
- **Unreadable resource in a focused dataset**: skip it (the model can still `readResource`); do not fail the turn.
- **Focused dataset larger than the budget**: injection is capped at the total character budget and the per-resource fetch bound (1000 rows), and the sample is flagged "частична извадка"; the model is nudged to use `readResource` + `filters` to get exact rows.
- **Empty rows in a resource**: surfaced honestly (e.g. "rows 11–16 are empty"), not padded with invented data.
- **No grounding and no relevant tool result**: reply exactly that no relevant public data was found — never a fabrication.
- **Sub-municipal район / row-value-only terms**: not in the search index; reachable only via grounding (row injection) or value-filter, not blind search.
- **Tool-shy / weak model**: grounding is robust by construction, but a tool-shy model may enumerate an injected sample incompletely and may not call the value-filter; exhaustive/exact answers depend on a more faithful model (see Assumptions).
- **Provider without tool-calling**: falls back to the retrieval (RAG) path, which still injects focused rows.

## Requirements *(mandatory)*

### Functional Requirements

(Continues the explorer chat FR series from feature 008; FR-016/FR-019/FR-023/FR-024/FR-025 are referenced from 008 and tightened here.)

- **FR-033**: The system MUST pre-read a bounded sample of each grounded dataset's resources and inject those rows (or document/text) into the model's context as a clearly labelled "ДАННИ (ground truth)" block, on BOTH the tool-loop path and the retrieval (RAG) fallback path.
- **FR-034**: The system MUST always cite a grounded (focused/reader/sticky) dataset whose rows were injected, even when the model invokes no tools.
- **FR-035**: The system prompt MUST forbid stating any specific value (name, code/ЕИК, number, publisher, URL) unless it appears verbatim in a tool result or the provided context, and MUST forbid fabricating data to agree with the user (reinforces FR-016).
- **FR-036**: The system MUST distinguish *tool scope* from *grounding*: `scope.datasetIds` is a hard focus that both injects rows and narrows tool scope; `groundingDatasetIds` injects rows WITHOUT narrowing tool scope.
- **FR-037**: The chat request MUST accept an optional `groundingDatasetIds: string[]` field (the dataset(s) open in the reader), and the web client MUST send the id of the dataset currently open in the reader.
- **FR-038**: Grounding precedence for a turn MUST be: explicit hard focus (`scope.datasetIds`) > reader focus (`groundingDatasetIds`) > sticky session context — and the same precedence MUST decide what is carried forward as the next turn's sticky context.
- **FR-039**: The session MUST remember what the conversation is "about" (`contextDatasetIds`): the explicit/reader focus if given, else the datasets the last answer cited; deduped and capped at a small bound (2). Their rows MUST be re-injected each turn so follow-ups stay grounded. This context is session-only and MUST NOT be persisted server-side (consistent with FR-019).
- **FR-040**: The system MUST replay only a bounded recent window of the transcript to the model, within a message-count budget and a character budget, always retaining at least the last message; grounding rows live in the system prompt and are unaffected by trimming.
- **FR-041**: The injected grounding block MUST be bounded by a total character budget across all grounded datasets/resources, and each resource fetch MUST be bounded (up to 1000 rows); partial samples MUST be flagged.
- **FR-042**: `readResource` MUST accept an optional `filters` argument (a map of EXACT column name → case-insensitive substring) forwarded to the resource grid query, returning ONLY matching rows scanned across the whole resource (up to the grid cap), independent of the injection budget.
- **FR-043**: The grounding context block MUST expose, per grounded resource, the resource's exact column names and `resourceId` so the model can target a value-filter precisely.
- **FR-044**: The chat MUST resolve a default LLM provider from server configuration (`EXPLORER_DEFAULT_*` env, Bun-loaded `.env`); a committed `.env.example` MUST document it and `.env` MUST be gitignored. The configured endpoint MUST support tool/function calling. User-supplied credentials MUST NOT be persisted or logged server-side (consistent with FR-024).

### Key Entities *(include if feature involves data)*

- **Conversation / session context**: the in-memory, session-only conversation. Holds the transcript (`messages`) and `contextDatasetIds` — the sticky set of datasets the conversation is grounded on (deduped, capped at `MAX_CONTEXT_DATASETS` = 2). Never persisted server-side.
- **Focus (grounding) context block**: the "ДАННИ (ground truth)" text injected into the system prompt — per grounded dataset: title + id, then per resource: total/shown row counts, a partial-sample flag, the exact column names, the `resourceId`, and the sampled rows (or document/text). Bounded by a total character budget.
- **ChatRequest fields**: `sessionId`, `message`, `scope` (`ScopeDescriptor`, incl. `datasetIds` hard focus), the new `groundingDatasetIds` (reader focus; row injection only), and `provider`.
- **`groundingDatasetIds` vs `scope.datasetIds`**: row-injection-only grounding signal vs. hard focus that also narrows tool scope; precedence explicit > reader > sticky.
- **History window budget**: the recent-turn replay bound — `MAX_HISTORY_MESSAGES` (10) and `MAX_HISTORY_CHARS` (24,000) — applied newest-first, always keeping the last message.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a focused dataset, every specific value in the answer appears verbatim in the injected rows or a tool result; 0% of answers contain invented names/codes/numbers. (Was: 16 fabricated identical rows; now: the 10 real clubs with their real ЕИКs, empty rows flagged.)
- **SC-002**: A follow-up turn with no explicit focus and no tool call still cites the dataset the previous answer was grounded in (sticky context holds across turns).
- **SC-003**: A sub-municipal район-level question against the open/focused dataset returns real matching rows, not "no data".
- **SC-004**: The injected grounding block stays under the total character budget even for a dataset whose raw rows would exceed it (e.g. ~180k chars capped to <100k), and is flagged as a partial sample.
- **SC-005**: A value-filter (`readResource` with `filters`) returns ONLY rows whose named column contains the substring (case-insensitive), scanning the whole resource up to the grid cap — exact and complete, independent of the injection budget.
- **SC-006**: With no server default provider configured the chat returns a clear, actionable error; with `EXPLORER_DEFAULT_*` set it streams a grounded answer and can invoke the mirror tools. No credential appears in logs.
- **SC-007**: A grounded turn carries forward the correct sticky context per the precedence rule (explicit > reader > cited) for the next follow-up.
- **SC-008**: The full test suite passes (1004 tests at #29); lint and typecheck are clean.

## Assumptions

- **Grounding-by-construction, not prompt-only**: robustness comes from injecting real rows and citing the focused dataset by construction, not from trusting the model to call tools — the prompt hardening is reinforcement, not the primary guarantee.
- **Model faithfulness caveat (HONEST)**: grounding is robust by construction, but the self-hosted `gemma-4-26b-uncensored` model is tool-shy and sometimes enumerates an injected sample incompletely and does not reliably call the value-filter. Exact/exhaustive answers therefore depend on a more faithful model; the *data is fully available* to the model either way, and the answer is always grounded (never fabricated). This is a stated limitation, not a defect of the grounding mechanism.
- **Tool-calling endpoint required**: the chat agent uses tools, so the configured provider endpoint must support tool/function calling (e.g. vLLM started with `--enable-auto-tool-choice`); a non-tool endpoint falls back to the retrieval path (which still injects focused rows).
- **Session-only memory**: conversations and sticky context are held in memory for the active session only and are never persisted server-side (FR-019); they are discarded on process restart.
- **Reader knows the open dataset**: the web reader reliably provides the id of the dataset currently open, which the client sends as `groundingDatasetIds`.
- **Bounded resources**: a single grounded resource fetch is bounded at 1000 rows and the whole grounding block at 90,000 characters; value-filter scans are bounded by the existing grid cap (`MAX_GRID_SCAN`).
- **Builds on 008**: this feature extends the explorer chat (feature 008) and reuses its `ScopeDescriptor`, the four mirror tool wrappers, the SSE event contract, and the in-process read API (feature 007).
