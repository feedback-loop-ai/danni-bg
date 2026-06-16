# Data Model: Trustworthy grounded chat

**Feature**: 017-grounded-chat · **Status**: Implemented

No database schema or migration. All state below is in-memory and session-only (FR-019), or transient per-turn context derived from the existing curated store via `ReadBridge`.

## Conversation (session-scoped, in-memory)

`apps/explorer-api/src/chat/session.ts` — held only for the active session, never persisted server-side, discarded on process restart.

| Field | Type | Notes |
|-------|------|-------|
| `sessionId` | `string` | round-trips with the client; server creates one when null |
| `messages` | `ChatMessage[]` | transcript: `{ role: 'user'\|'assistant', content, citations?, anchors? }` |
| `contextDatasetIds` | `string[]` | **sticky grounding** — the datasets the conversation is currently "about"; their rows are re-injected each turn |

**`contextDatasetIds` rules**:
- Set after each turn by `SessionStore.setContext`, which **dedupes** (`new Set`) and **caps** at `MAX_CONTEXT_DATASETS` (= 2) — these rows are re-read every turn, so the set is kept small.
- Carry-forward precedence (matches the per-turn grounding precedence): explicit hard focus (`scope.datasetIds`) if any → reader focus (`groundingDatasetIds`) if any → else the datasets the answer cited.
- Session-only; never persisted (consistent with FR-019).

## Focus (grounding) context block

Built per turn by `buildFocusContext(bridge, datasetIds, resolve)` in `apps/explorer-api/src/chat/run.ts`; returns `{ text, ids } | null`. Injected into the system prompt (tool-loop) or the user message (RAG fallback) under the `FOCUS_HEADER` ("ДАННИ (ground truth) …").

Per grounded **dataset**:
- `Набор от данни „<title.bg>“ (id: <datasetId>).`

Per grounded **resource** (rows case):
- A header line: `Ресурс „<name>“ (resourceId: <resourceId>) — <total> реда общо, показани <shown><note>. Колони: <col1, col2, …>.`
  - `<note>` = ` (частична извадка)` when the sample was truncated.
  - **Column names** are the exact keys of the first row — exposed so the model can target a `readResource` value-filter precisely.
- Then the rows as JSON.
- Document / text resources are emitted analogously (`(документ)` / `(текст)`).

**Bounds** (so the system prompt can't overflow the context window):
| Constant | Value | Meaning |
|----------|-------|---------|
| `FOCUS_ROWS` | 1000 | max rows fetched per resource (was 50 — too few for район recall) |
| `GROUNDING_TOTAL_CHARS` | 90,000 | total char budget across ALL grounded datasets/resources |

A running `budget` starts at `GROUNDING_TOTAL_CHARS`; each resource is capped via `capResourceContent(content, budget)` and the budget is decremented by the emitted body length; iteration stops when the budget is exhausted. Truncated samples are flagged.

`ids` = the grounded dataset ids that resolved — used to **always cite** the grounded dataset even when the model called no tools.

## ChatRequest fields

`chatRequestSchema` in `apps/explorer-api/src/routes/chat.ts` (Zod, `.strict()`):

| Field | Type | Notes |
|-------|------|-------|
| `sessionId` | `string \| null \| undefined` | null → server creates one |
| `message` | `string` (min 1) | the user turn |
| `scope` | `ScopeDescriptor?` | filter scope; `scope.datasetIds` is the **hard focus** |
| `groundingDatasetIds` | `string[]?` | **NEW** — reader focus: inject these datasets' rows WITHOUT narrowing tool scope |
| `provider` | `ProviderConfig` | per-request; never persisted/logged (FR-024) |

## `groundingDatasetIds` vs. `scope.datasetIds`

| | `scope.datasetIds` (hard focus) | `groundingDatasetIds` (reader focus) |
|---|---|---|
| Injects rows as ground-truth context | ✅ | ✅ |
| Narrows tool scope (what tools may read) | ✅ | ❌ |
| Source | explicit "ask about this dataset" | the dataset currently open in the reader |
| Carried forward to sticky context | yes (highest precedence) | yes (middle precedence) |

**Per-turn grounding precedence** (row injection only; chosen set is what `buildFocusContext` reads):
`scope.datasetIds` (non-empty) → `groundingDatasetIds` (non-empty) → `conv.contextDatasetIds` (sticky).

The chosen set is passed to `runChatTurn` as `groundingDatasetIds` (the run option); `buildFocusContext` defaults to `scope.datasetIds` when that option is omitted.

## History window budget

`windowMessages(messages, maxMessages, maxChars)` in `session.ts` — bounds what is replayed to the model:

| Constant | Value | Meaning |
|----------|-------|---------|
| `MAX_HISTORY_MESSAGES` | 10 | max messages replayed |
| `MAX_HISTORY_CHARS` | 24,000 | char budget across replayed messages |

Algorithm: iterate newest-first, push messages until either limit would be exceeded, then reverse to original order. **Always keeps at least the last message** (the char check is skipped for the first kept message). Grounding rows live in the system prompt, not the replayed transcript, so trimming old turns never drops the grounding.

## readResource value-filter

`readResource` tool input (`apps/explorer-api/src/chat/tools.ts`):

| Field | Type | Notes |
|-------|------|-------|
| `datasetId` | `string` | in-scope only (else `{ outOfScope: true }`) |
| `resourceId` | `string` | |
| `limit` | `int (1..1000)?` | |
| `offset` | `int (≥0)?` | |
| `filters` | `Record<string,string>?` | **NEW** — EXACT column name → case-insensitive substring |

When `filters` is non-empty it is forwarded as `{ sort: null, filters }` to `bridge.rows(...)`'s grid argument; the grid scans the whole resource (up to `MAX_GRID_SCAN` = 100k) and returns only matching rows, ANDed across columns. Independent of the injection budget, so it works on datasets too big to inject.

## Citations & anchors (unchanged shape, reinforced rules)

`grounding.ts` — `Citation = { datasetId, titleBg, sourceUrl, freshness }`; `MapAnchor = { geoEntityIds, datasetIds }`. The grounded dataset ids are unioned with the tool-cited ids before `buildCitations`, which still validates existence and scope (drops unresolved/out-of-scope ids). The `SYSTEM_PROMPT` is hardened to forbid stating any value not present verbatim in a tool result/context and to forbid fabricating to agree with the user.
