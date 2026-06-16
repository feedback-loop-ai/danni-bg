# Contract: Chat grounding tools (grounded-chat delta)

**Feature**: 017-grounded-chat · **Module**: `apps/explorer-api/src/chat`

This is a **delta** over `specs/008-map-data-explorer/contracts/chat-tools.md`. It adds the `readResource` `filters` argument, the grounding context block (with exposed column names), and tightens the grounding/citation contract. Tools remain 1:1 wrappers over the in-process read API (Constitution I/III); inputs are Zod-validated (Constitution VII); each wrapper keeps its parity-matrix row (Constitution VIII).

The four tools (`mirrorSearch`, `mirrorEntitySearch`, `mirrorInfo`, `readResource`) and the `ScopeDescriptor` are unchanged except as below.

## Tool: readResource  (UPDATED — value-filter)

Wraps `readResourceRows(...)` via `ReadBridge.rows(...)`.
- **Input**: `{ datasetId: string, resourceId: string, limit?: number(<=1000), offset?: number, filters?: Record<string,string> }`
- **`filters` (NEW)**: a map of **EXACT column name → case-insensitive substring**, e.g. `{ "rayon": "Панчарево" }`. When non-empty it is forwarded to the resource grid query as `{ sort: null, filters }`. The grid scans the **whole** resource (up to `MAX_GRID_SCAN` = 100k rows) and returns **ONLY** matching rows, ANDed across columns — exact, complete, and **independent of the grounding-injection budget**, so it works on datasets too big to inject. Prefer `filters` over paging for value questions.
- **Behavior**: out-of-scope `datasetId` → `{ outOfScope: true, datasetId }`. Payload is size-capped (`capResourceContent`) so a large artifact can't overflow the model context. Returns paginated/sampled rows (or document/text) + resource freshness.
- **Description hint**: the tool description tells the model to pass `filters` for value questions and that column names are listed in the dataset context block and in `mirrorInfo`.

## Grounding context block  (NEW — `buildFocusContext`)

Before the model runs, the backend pre-reads the grounded dataset(s) (per the request precedence — see `http-api.md`) and injects a "ДАННИ (ground truth)" block. This makes the answer grounded by construction on BOTH the tool-loop and the RAG fallback paths.

Per grounded **dataset**: `Набор от данни „<title.bg>“ (id: <datasetId>).`

Per grounded **resource** (rows): a header
`Ресурс „<name>“ (resourceId: <resourceId>) — <total> реда общо, показани <shown>[ (частична извадка)]. Колони: <col, …>.`
followed by the rows as JSON. Documents/text are emitted analogously.

- **Exposed column names + `resourceId`** (NEW): so the model can target a `readResource` `filters` precisely (e.g. the `rayon` column).
- **Bounds**: up to `FOCUS_ROWS` = 1000 rows per resource; whole block capped at `GROUNDING_TOTAL_CHARS` = 90,000 across all grounded datasets/resources; truncated samples flagged `(частична извадка)`.

## Grounding & citation contract  (UPDATED)

Implemented in `grounding.ts` + `run.ts`, contract-tested against fixtures:

1. **System prompt** (`SYSTEM_PROMPT`) instructs: answer ONLY from tool results and the provided "ДАННИ"/"DATA" context block; **never invent or guess** datasets, row values, names, codes (ЕИК/EIK), numbers, publishers, or URLs; state a specific value ONLY if it appears verbatim in a tool result or the context, else say it cannot be seen; **do not fabricate to agree with the user**; when a question spans datasets call `readResource` on each; reply "no relevant public data found" when nothing is relevant; surface freshness; flag coded/translated values; never rewrite authoritative Bulgarian fields (FR-016, FR-035).
2. **Citation extraction**: the grounded dataset ids (whose rows were injected) are **unioned** with the dataset ids the model relied on via tools, then passed to `buildCitations`.
3. **Existence validation**: every candidate id MUST resolve via `datasetView`; unresolved/hallucinated ids are dropped (SC-001 — no invented/unresolvable citations).
4. **Scope validation**: cited datasets MUST be ⊆ `scope` (SC-007 — correct grounded/cited set per precedence).
5. **Always-cite-grounded**: a grounded dataset that resolves and is in scope is cited even when the model calls no tools (FR-034).
6. **Anchors**: from cited datasets' geo entities, emit a `MapAnchor` (FR-026/FR-027).

## Parity matrix obligations

The four tool wrappers keep their parity rows; the `readResource` value-filter is an additive arg covered by `apps/explorer-api/tests/chat-tools.test.ts` ("readResource forwards filters to the grid"); the grounding block + column exposure by `chat-focus.test.ts`.
