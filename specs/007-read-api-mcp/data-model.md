# Data Model — 007-read-api-mcp

**Date**: 2026-06-05
**Status**: Implemented
**Scope**: **No database schema change and no new migration.** This feature added a
stable in-process read API (`src/read/`) and a read-only MCP server (`src/mcp/`) over the
*already-persisted* curated mirror. It introduced one new **internal** content shape
(`ResourceContent`), relocated one existing composed-read shape (`CuratedDatasetView`, the
former `composeView`) out of the CLI into `src/read/`, and added the MCP wire/handler types
(`JsonRpcRequest`/`JsonRpcResponse`, `McpContext`, tool defs). It published **no** new
JSON-Schema contract: the search tools emit the existing `index-entry.schema.json` shape and
`mirror_info` emits the existing `curated-dataset.schema.json` shape; `read_resource` returns
the internal `ResourceContent` shape, which is documented in the MCP tool table (and in
`docs/CONSUMERS.md`), not as a published schema. There is therefore **no `contracts/`
directory** for this feature, exactly as for 002, 003 and 005.

> **Naming convention** (inherited from 001): `snake_case` SQL identifiers;
> `kebab-case` file paths; `camelCase` TypeScript fields. Timestamps are ISO-8601
> UTC `TEXT` via `nowIso()` (`src/lib/time.ts`).

---

## 1. No schema change / no migration

The last applied migration remains `005_index_state.sql` (from feature 003). This feature
added **no** `migrations/*.sql` file. Everything it does is a **read** over state that earlier
features persisted. Confirmation that nothing in the data layer changed:

- No new table, column, or index. The read API consults existing tables only — `datasets`,
  `organizations`, `resources`, `curated_artifacts`, `entities` (+ attachments), `dataset_links`
  and `translations` for the dataset record; the FTS + vector stores for search — via their
  existing repos, read-only.
- `readResourceRows` reads the **curated artifact bytes off disk** under `store/curated/`; it
  never writes. The store on disk remains the source of truth (US1, SC-003).
- No published contract file changed. `curated-dataset.schema.json` and `index-entry.schema.json`
  (owned by 001) are byte-for-byte unchanged and are *reused* as the tool output contracts (SC-002).

The read API and MCP server are net-new code that depends on the data layer; the data layer
does not depend on them.

---

## 2. Relocated composed-read shape — `CuratedDatasetView` (FR-001, R2)

`CuratedDatasetView` (`src/read/dataset-view.ts`) is the machine-consumer-facing curated-dataset
record — `datasets` + `organizations` + `curated_artifacts` + entity attachments + `dataset_links`
+ `translations` composed into one object, conforming to `curated-dataset.schema.json`. It is the
**renamed `composeView`**, moved out of `cli/mirror-info.ts` so that both the `mirror-info` CLI and
the MCP server *depend on* it rather than the read path being buried inside the CLI (the wrong
dependency direction — R2). Neither the shape nor the SQL changed in the move; only its home and
name did.

The exported entry point:

```ts
function datasetView(db: Database, datasetId: string, freshnessSloSeconds: number): CuratedDatasetView
```

| Aspect | Settled behavior |
|---|---|
| Composition | One point lookup per related table via existing repos (`DatasetsRepo`, `OrganizationsRepo`, `ResourcesRepo`, `CuratedArtifactsRepo`, `EntitiesRepo`, `DatasetLinksRepo`, `TranslationsRepo`). Read-only. |
| Bilingual rule | Original Bulgarian fields (`title.bg`, `description.bg`, entity `label.bg`) are present unmodified; English helpers (`*.en`, `translator`, `translationConfidence`) are clearly marked and never replace originals (Principle X). |
| `freshness.isStale` | Derived, not stored: `(Date.now() - lastSyncedAt) / 1000 > freshnessSloSeconds`, computed per dataset and per resource against the caller-supplied SLO. |
| Missing dataset | Throws `dataset <id> not found` — surfaced by the CLI/MCP boundary, not swallowed. |
| Consumers | `src/cli/mirror-info.ts` (which now imports `datasetView`) and the `mirror_info` MCP tool. The two cannot diverge because they share this one function. |

Two existing tests that imported `composeView` (`tests/contract/curated-dataset.test.ts`,
`tests/integration/offline-read.test.ts`) were repointed to `src/read/` — same assertions, new
import path.

---

## 3. New internal content shape — `ResourceContent` (FR-002)

`ResourceContent` (`src/read/resource-rows.ts`) is the **only new data shape** this feature adds.
It is the curated content of a single resource, read straight off disk so a consumer never has to
know the on-disk layout. It is an *internal* shape — documented in the MCP tool table and
`docs/CONSUMERS.md`, **not** a published JSON Schema (it has no `additionalProperties:false`
closure and is not added to any `contracts/` directory).

```ts
function readResourceRows(
  db: Database,
  storeRoot: string,
  datasetId: string,
  resourceId: string,
  opts?: { limit?: number; offset?: number },
): ResourceContent
```

The shape:

| Field | Type | Meaning |
|---|---|---|
| `datasetId` | `string` | Echoed; the owning dataset. |
| `resourceId` | `string` | Echoed; the resource. |
| `kind` | `CuratedKind \| null` | The curated artifact kind (`tabular`/`json`/`geojson`/`xml`/`text`); `null` when the resource is uncurated or its artifact path is absent. |
| `curatedPath` | `string \| null` | Relative path under `store/curated/` to the artifact; `null` when uncurated. |
| `rows` | `unknown[]` | Paginated rows for tabular (NDJSON) and JSON-array artifacts; `[]` otherwise. |
| `document?` | `unknown` | Present only for a single JSON/GeoJSON **object** artifact. |
| `text?` | `string` | Present only for an XML/text artifact (verbatim). |
| `total` | `number` | Total row count (tabular/array); `1` for a document; `0` for text/uncurated. |
| `limit` | `number` | Effective page size, clamped to `[1, 1000]` (default 100). |
| `offset` | `number` | Effective row offset, clamped to `>= 0` (default 0). |
| `truncated` | `boolean` | `true` when more rows exist beyond `offset + limit`. |

### 3.1 Off-disk dispatch by artifact kind

The shape returned is decided by `artifact.kind` (FR-002):

| Artifact | Result |
|---|---|
| `tabular` (NDJSON) | Split on newlines, drop blanks, JSON-parse the `[offset, offset+limit)` slice → `rows`; `total` = line count. |
| `json` / `geojson` array | Slice the parsed array → `rows`; `total` = array length. |
| `json` / `geojson` object | Whole parsed value → `document`; `total` = 1. |
| `xml` / `text` | Raw bytes → `text`; `total` = 0. |
| uncurated / artifact path empty / file absent on disk | Base record: empty `rows`, `kind: null`, `total: 0`. |

### 3.2 Invariants

| Invariant | Settled behavior |
|---|---|
| Ownership check | Throws `resource <id> not found in dataset <id>` when the resource row is missing **or** belongs to a different dataset — a resource can only be read through its real owning dataset. |
| Descriptive parse error | A malformed curated file throws `failed to parse curated artifact <path>: <reason>` — the on-disk path is named so the failure is diagnosable (hardened from review). |
| Pagination clamp | `limit` is clamped to `MAX_LIMIT = 1000`; an explicit `offset: 0` is honored (passed as `!== undefined`, not by truthiness). |
| Read-only | Reads bytes via `readFileSync` under `join(storeRoot, 'curated', artifact.path)`; never writes. |

---

## 4. The read substrate — `src/read/index.ts` (FR-001, FR-003)

`src/read/index.ts` is the stable, in-process read API: the single substrate both the
`mirror-info` CLI and the `danni mcp` server consume. It re-exports the four read entry points and
their types:

| Re-export | Source | Returns |
|---|---|---|
| `datasetView` | `./dataset-view.ts` | `CuratedDatasetView` (curated-dataset record, §2) |
| `readResourceRows` | `./resource-rows.ts` | `ResourceContent` (off-disk rows/document/text, §3) |
| `search` | `../index/query.ts` | `IndexEntry[]` (existing 005-grounded read contract) |
| `searchByEntity` | `../index/query.ts` | `IndexEntry[]` |

The dependency direction is enforced by construction: `src/read/` imports from the data layer; the
CLI and MCP server import from `src/read/` — never the reverse (R2, US1).

### 4.1 Relationship to the model-change re-embed (006)

`search` / `searchByEntity` query the FTS + vector stores that the indexing pipeline populated. The
re-embed decision that keeps those vectors current is owned upstream by the indexing feature
(006): `run-index.ts` records the global embedder identity (`modelIdOf(opts.embedder)`) at run
start, and the per-dataset decision in `index-state.ts` re-embeds a dataset when the stored
`index_state.model_id` differs from the current embedder's id (tagging that work
`reembeddedDueToModelChange` vs content-change). This read feature is a **pure consumer** of the
resulting vectors: it adds no re-embed logic, no `model_id` write, and no new vector store. It only
needs an `Embedder` to embed the *query* text at search time — supplied through `McpContext`
(§5). Because vectors are keyed by the model that produced them, the read surface always queries a
consistent embedding space; if the operator changes the model, the *write* pipeline (006) re-embeds,
and the read API transparently serves the refreshed vectors with no change here.

---

## 5. MCP wire and handler types — `src/mcp/server.ts` (FR-003, FR-004, R1)

A dependency-free, spec-compliant MCP server (no `@modelcontextprotocol/sdk` — the read-only
surface is small and stable, so the project keeps `zod` as its only runtime dep; swapping in the
official SDK later is a transport-only change — R1). `handleRpc` is a pure request handler (no I/O)
so it can be exercised directly in tests. None of these are published contracts.

### 5.1 `McpContext`

The shared, read-only handler context:

```ts
interface McpContext {
  db: Database;
  storeRoot: string;
  embedder: Embedder;       // embeds the QUERY text only; vectors come from the 006 pipeline
  freshnessSloSeconds: number;
}
```

There is **no new config field** for this feature. The `danni mcp` CLI builds `McpContext` from
*existing* config read by `loadConfig()`: `config.store.root` → `storeRoot`,
`config.enrichment.embedder` → `buildEmbedder(...)`, and `config.store.freshnessSloSeconds` →
`freshnessSloSeconds`. The DB is opened read-side with `loadVec: false`.

### 5.2 JSON-RPC wire types

```ts
interface JsonRpcRequest  { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown; }
interface JsonRpcResponse { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string }; }
```

Protocol behavior (FR-003, R3, R4, R5, SC-004):

| Case | Behavior |
|---|---|
| Notification (`id` is `undefined`) | `handleRpc` returns `null`; the loop writes nothing. A read server has no side effect to run on a notification, so it is accepted silently (R3). |
| Missing `method` on a request | JSON-RPC error `-32600` (invalid request). |
| Unknown `method` on a request | JSON-RPC error `-32601` (method not found). |
| `initialize` | Advertises the server's own `protocolVersion` (`'2024-11-05'`) — does **not** echo an arbitrary client value (R4) — plus `capabilities.tools` and `serverInfo` (`{ name: 'danni-bg', version: '0.1.0' }`). |
| `ping` | Empty result `{}`. |
| Tool failure | Returned as a **successful** envelope `{ content, isError: true }` (MCP convention, R5); only protocol-level problems use JSON-RPC error codes. |
| Malformed line (CLI) | `dispatchLine` returns a `-32700` parse error (`src/cli/mcp.ts`). |

### 5.3 Tool definitions (FR-004)

A `ToolDef` is `{ name; description; inputSchema; run(args, ctx) }`, where `inputSchema` is a
JSON-Schema object (`additionalProperties:false`) advertised over `tools/list`, and `run`
zod-validates its arguments before calling the read API. Four read-only tools, no write tools:

| Tool | Reads via | Output shape (reused contract) |
|---|---|---|
| `mirror_search` | `search` | `index-entry.schema.json` (SC-002) |
| `mirror_entity_search` | `searchByEntity` | `index-entry.schema.json` (SC-002) |
| `mirror_info` | `datasetView` | `curated-dataset.schema.json` (SC-002) |
| `read_resource` | `readResourceRows` | internal `ResourceContent` (§3) |

No `sync` / `curate` / `index` (write) tool is exposed; the store is the source of truth (SC-003).
Tool results are JSON-serialized into the `content[].text` of the `tools/call` envelope.

---

## 6. Validation rules

Consistent with data-model 001 §5 (Zod/contract at every boundary):

1. **No new persisted-record load and no new config**: every table read by this feature already
   had its load contract defined by 001/002/003, and `McpContext` is built entirely from existing
   config fields (`store.root`, `store.freshnessSloSeconds`, `enrichment.embedder`).
2. **Reused published contracts**: `curated-dataset.schema.json` (`mirror_info`) and
   `index-entry.schema.json` (`mirror_search`/`mirror_entity_search`) are the read-consumer
   contracts the tools emit; both are owned by 001 and untouched (SC-002). Their existing contract
   tests remain the enforcement point.
3. **Internal shapes are not published contracts**: `ResourceContent`, the JSON-RPC wire types,
   `McpContext` and the tool defs are internal module surfaces, documented in the MCP tool table
   and `docs/CONSUMERS.md`, and are therefore not added to `specs/.../contracts/` — matching 002,
   003 and 005.
4. **Tool arguments validated at the edge**: each tool zod-parses its arguments inside `run`; a
   validation failure surfaces as a `{ isError: true }` tool envelope, never a protocol error (R5).

---

## 7. Relationship to existing tables and contracts

```
datasets / organizations / resources / curated_artifacts / entities / dataset_links / translations
                                        (read by datasetView → CuratedDatasetView → curated-dataset.schema.json)
curated artifact bytes under store/curated/<datasetId>/<resourceId>/data.*
                                        (read by readResourceRows → ResourceContent; off disk, never written)
FTS + vector stores                     (read by search/searchByEntity → IndexEntry → index-entry.schema.json)
index_state.model_id                    (owned by 006: the write-side re-embed key; the read API only consumes the vectors it keys)
config.store.root / freshnessSloSeconds / enrichment.embedder
                                        (read by `danni mcp` to build McpContext; no new config field)
```

`src/read/` is the single substrate where the curated record, the on-disk artifacts and the search
index are made consumable in one place; `src/mcp/server.ts` exposes exactly that substrate over
read-only JSON-RPC. Neither introduces persistent state, and both depend on the data layer rather
than the data layer depending on them.
