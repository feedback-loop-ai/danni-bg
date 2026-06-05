# Feature Specification: Stable Read API + Read-Only MCP Server

**Feature Branch**: `007-read-api-mcp`  
**Created**: 2026-06-05  
**Status**: Implemented (shipped in commit `d16c1a5`, "feat(read): stable read API + read-only MCP server (Track C)")  
**Input**: User description: "v1 emitted machine-readable contracts and a CLI (mirror-info/search) but had no programmatic, agent-facing read surface — the only composed read path (composeView) was buried inside the mirror-info CLI command. Extract a stable in-process read API and expose it over a read-only MCP server so LLM agents can search, inspect and pull curated datasets without depending on the live portal or the write pipeline. This is the deliberate v1 follow-up named in README/Constitution: the production-facing READ interface for downstream LLM-agent consumers. Read-only — the store on disk remains the source of truth."

## Clarifications

### Session 2026-06-05

- Q: Hand-roll the MCP server, or add `@modelcontextprotocol/sdk`? → A: Hand-roll a minimal, spec-compliant server (R1). The read-only surface (`initialize` / `tools/list` / `tools/call` / `ping`) is small and stable, and the project keeps `zod` as its only runtime dependency. Swapping in the official SDK later is a transport-only change. Adding the SDK was rejected for the dependency weight.
- Q: Which way should the dependency between the CLI and the read API point? → A: The read API lives in `src/read/` and BOTH the `mirror-info` CLI and the MCP server DEPEND ON it — never the reverse (R2). `composeView` was inside the CLI (the wrong direction); it is renamed to `datasetView` and moved into `src/read/`. The MCP server imports the read API; the read API never imports the CLI or the server.
- Q: How should the server treat a JSON-RPC notification (a message with no `id`)? → A: Per JSON-RPC 2.0 it MUST get NO response (R3). A read server has no side effects to run on a notification (e.g. `notifications/initialized`), so any notification is simply accepted silently.
- Q: Should `initialize` echo the client's requested protocol version? → A: No (R4). The server advertises the single protocol version it supports rather than echoing an arbitrary client value.
- Q: How are tool failures distinguished from protocol errors? → A: Tool failures are returned as a successful JSON-RPC result envelope with `isError: true` (the MCP convention, R5); only protocol-level problems — an unknown method or a missing method — use JSON-RPC error codes (`-32601` / `-32600`), and a line that does not parse as JSON yields `-32700`.
- Q: Does this feature change the database schema or add a new external contract? → A: No. There is no new migration. The tool outputs reuse the existing `curated-dataset.schema.json` (for `mirror_info`) and `index-entry.schema.json` (for `mirror_search` / `mirror_entity_search`); `read_resource` returns an internal `ResourceContent` shape documented in the MCP tool table, not a published JSON Schema. There is therefore no `contracts/` directory (matching 002, 003 and 005).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stable read API decoupled from the CLI (Priority: P1)

A stable, in-process read API lives in `src/read/`: `datasetView()` (the curated-dataset record) and a new `readResourceRows()` (a resource's curated rows / document / text, read off disk). Both the `mirror-info` CLI and the MCP server consume this API; the API never depends on either of them.

**Why this priority**: The only composed read path in v1 (`composeView`) was buried inside the `mirror-info` CLI command, so the agent-facing server could only reach it by depending on the CLI — the wrong direction. Extracting the read substrate first is the load-bearing prerequisite for everything else: without it the MCP server would either duplicate composition logic or invert the dependency. It is P1 because the whole feature stands on a correctly-placed, reusable read API.

**Independent Test**: Import `datasetView` and `readResourceRows` from `src/read/` (not from the CLI), compose a curated dataset and read a curated resource's rows directly, and assert `src/cli/mirror-info.ts` imports `datasetView` from `src/read/` (never the reverse).

**Acceptance Scenarios**:

1. **Given** a curated dataset in the store, **When** `datasetView(db, datasetId, freshnessSloSeconds)` is called from `src/read/`, **Then** it returns the full curated-dataset record (datasets + organizations + curated artifacts + entities + links + translations) and `cli/mirror-info.ts` produces its output by importing that same function.
2. **Given** a curated resource on disk, **When** `readResourceRows(db, storeRoot, datasetId, resourceId, {limit, offset})` is called, **Then** it returns the resource's curated content read straight off disk, with pagination, without the caller knowing the on-disk layout.
3. **Given** `src/read/index.ts`, **When** it is imported, **Then** it re-exports `datasetView`, `readResourceRows`, `search` and `searchByEntity` as the single read surface.

---

### User Story 2 - Agent-consumable over MCP (Priority: P1)

An LLM agent points an MCP client at `danni mcp` and gets read-only tools to search the mirror, search by entity, inspect a dataset, and read a resource's rows — without touching the live portal or the write pipeline.

**Why this priority**: This is the production-facing READ interface the feature exists to ship — the v1 follow-up named in the README/Constitution. v1 had machine-readable contracts and a human CLI but no programmatic, agent-facing read surface. It is P1 because it is the headline capability: an agent that can search, inspect and pull curated data over a standard protocol.

**Independent Test**: Drive the MCP request handler with `initialize`, `tools/list` and a `tools/call` for each of the four tools, and assert the four read-only tools are present and return curated data; assert no write tool (sync / curate / index) is exposed.

**Acceptance Scenarios**:

1. **Given** an MCP client pointed at `danni mcp`, **When** it lists tools, **Then** it sees exactly four read-only tools — `mirror_search`, `mirror_entity_search`, `mirror_info`, `read_resource` — and no write tool.
2. **Given** a `tools/call` for `mirror_search` or `mirror_entity_search`, **When** it runs, **Then** it returns ranked dataset pointers (index entries) from the curated mirror.
3. **Given** a `tools/call` for `mirror_info` then `read_resource`, **When** they run, **Then** the agent gets the full curated-dataset record and then a resource's curated rows / document / text — all read-only, never the live portal.

---

### User Story 3 - Protocol-correct + safe (Priority: P2)

The server speaks JSON-RPC 2.0 over stdio: notifications get no response, unknown methods return `-32601`, tool failures are returned as `{ isError: true }` result envelopes (not protocol errors), and stdout carries only JSON-RPC.

**Why this priority**: An MCP client multiplexes the session over a single stdio pipe, so a single stray line on stdout or a misclassified error breaks the transport for every subsequent message. Getting the protocol details right — notification handling, error-code vs. tool-error distinction, a clean stdout — is what makes the server actually usable by a real client. It is P2 because the tools already return correct data (US1/US2); this hardens how that data is delivered.

**Independent Test**: Send a notification (no `id`) and assert no response is written; send an unknown method and assert a `-32601` error; call a tool with bad arguments / an unknown dataset and assert an `isError: true` result envelope (not a JSON-RPC error); send a line that is not JSON and assert a `-32700` parse error.

**Acceptance Scenarios**:

1. **Given** a JSON-RPC message with no `id` (a notification), **When** the server handles it, **Then** it produces NO response and writes nothing.
2. **Given** a request for an unknown method, **When** the server handles it, **Then** it returns a JSON-RPC error with code `-32601`; a request missing a method string returns `-32600`; a non-JSON line returns `-32700`.
3. **Given** a `tools/call` whose tool throws (unknown tool name, invalid arguments, missing dataset), **When** the server handles it, **Then** it returns a successful envelope with `content` and `isError: true`, and the session continues — stdout still carries only JSON-RPC (logs go to stderr).

---

### User Story 4 - Documented for consumers (Priority: P2)

`docs/CONSUMERS.md` shows a downstream consumer the MCP client config, the four tools and their I/O, the on-disk store layout, and the contracts for direct consumption; `cli.md` gains the `danni mcp` entry.

**Why this priority**: A read interface aimed at external machine consumers is only as useful as its documentation — an agent author needs the client config, the tool signatures, and the choice between MCP and reading the store directly. It is P2 because the runtime surface already works (US1–US3); this makes it adoptable without reading the source.

**Independent Test**: Read `docs/CONSUMERS.md` and confirm it documents the MCP client config (command / args / cwd / env), all four tools with their arguments and returns, and the on-disk layout + contracts; read `cli.md` and confirm the `danni mcp` entry is present.

**Acceptance Scenarios**:

1. **Given** `docs/CONSUMERS.md`, **When** a consumer reads it, **Then** it shows a working MCP client config block (command / args / cwd / env) and a table of the four tools with their arguments and returns.
2. **Given** the same doc, **When** a consumer prefers to read the store directly, **Then** it shows the on-disk layout (`raw/` / `curated/` / `danni.sqlite`) and the JSON-Schema contracts, noting which tool output maps to which schema and that `read_resource` returns the internal `ResourceContent` shape.
3. **Given** `specs/001-egov-data-sync/contracts/cli.md`, **When** the command reference is read, **Then** it includes a `danni mcp` entry.

---

### Edge Cases

- A resource that is uncurated or whose curated path is absent — `readResourceRows` MUST return empty `rows` with `kind: null` (the raw resource still exists, but there is no readable curated artifact).
- A `resourceId` that does not exist, or exists but belongs to another dataset — `readResourceRows` MUST throw (`resource … not found in dataset …`); the MCP layer turns that into an `isError: true` result.
- A curated artifact file that is present but malformed (unparseable JSON / NDJSON line) — `readResourceRows` MUST throw a descriptive error naming the artifact path, not a bare parser message.
- A single JSON / GeoJSON object vs. a JSON array vs. NDJSON — the same `read_resource` call MUST yield `document` for the object, paginated `rows` for the array and the NDJSON, and `text` for XML / plain text.
- A JSON-RPC notification (no `id`) interleaved in the stream — it MUST be accepted silently with no response, so the client's request/response pairing is never disturbed.
- A stdin chunk that splits a JSON-RPC line across reads, or a final line with no trailing newline — the stdio loop MUST buffer across chunks and still process a trailing newline-less line.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `src/read/` MUST expose `datasetView(db, datasetId, freshnessSloSeconds)` (moved out of `cli/mirror-info.ts`, which now imports it) and `readResourceRows(db, storeRoot, datasetId, resourceId, {limit, offset})`; `src/read/index.ts` MUST re-export them plus `search` / `searchByEntity`.
- **FR-002**: `readResourceRows` MUST read the curated artifact off disk: tabular (NDJSON) and JSON-array artifacts → paginated `rows`; a single JSON / GeoJSON object → `document`; XML / text → `text`; an uncurated or absent artifact → empty `rows` with `kind: null`. It MUST throw if the resource is missing or belongs to another dataset, and MUST throw a descriptive error (naming the artifact path) on a malformed file.
- **FR-003**: A dependency-free MCP server (`src/mcp/server.ts`) MUST implement `initialize` / `ping` / `tools/list` / `tools/call` over newline-delimited JSON-RPC 2.0; a notification (no `id`) MUST receive NO response; an unknown method on a request MUST return `-32601`; a tool error MUST be returned as a result envelope with `content` and `isError: true`.
- **FR-004**: The server MUST expose exactly four read-only tools, each `zod`-validating its arguments: `mirror_search`, `mirror_entity_search`, `mirror_info`, `read_resource`. It MUST NOT expose any write tool (sync / curate / index).
- **FR-005**: The `danni mcp` CLI (`src/cli/mcp.ts`) MUST run the newline-delimited stdin/stdout loop (buffered across chunks; a trailing line without a newline is processed; a malformed line → `-32700`); it MUST log to stderr so stdout is pure JSON-RPC; the command MUST be registered in `danni.ts`.
- **FR-006**: `docs/CONSUMERS.md` MUST document the MCP client config (command / args / cwd / env), the four tools and their I/O, and the on-disk layout + contracts; `cli.md` MUST gain the `danni mcp` entry.

### Key Entities

- **CuratedDatasetView** (`src/read/dataset-view.ts`): the curated-dataset record (datasets + organizations + curated artifacts + entities + links + translations) composed into one object; conforms to `curated-dataset.schema.json`. `datasetView` is the renamed `composeView`, now typed against `bun:sqlite`'s `Database`.
- **ResourceContent** (`src/read/resource-rows.ts`): `{ datasetId, resourceId, kind, curatedPath, rows[], document?, text?, total, limit, offset, truncated }`. An internal shape, documented in the MCP tool table rather than as a published JSON Schema.
- **MCP wire types** (`src/mcp/server.ts`): `JsonRpcRequest` / `JsonRpcResponse`; the tool definitions (each with a JSON-Schema `inputSchema` and a `zod`-validated `run`); and `McpContext` `{ db, storeRoot, embedder, freshnessSloSeconds }` — the read-only handle passed to every tool.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A real stdio session (`echo` JSON-RPC piped into `danni mcp`) returns spec-compliant responses for `initialize`, `tools/list` and `tools/call` (verified).
- **SC-002**: The tool outputs reuse the existing contracts: `mirror_info` → `curated-dataset.schema.json`; `mirror_search` / `mirror_entity_search` → `index-entry.schema.json`.
- **SC-003**: The server is read-only — no tool mutates the store.
- **SC-004**: Notifications produce no response, and protocol errors and tool errors are correctly distinguished.

## Assumptions

- This is a retrofit: the work is already shipped and verified (commit `d16c1a5`, Track C), so the spec is written in the settled tense and marked Implemented.
- No new database migration: the schema is unchanged; the read API and server read the existing store.
- No new external contract and therefore no `contracts/` directory (matching 002, 003 and 005): `mirror_info` reuses `curated-dataset.schema.json`, `mirror_search` / `mirror_entity_search` reuse `index-entry.schema.json`, and `read_resource` returns the internal `ResourceContent` shape documented in the MCP tool table.
- The store on disk remains the source of truth; this feature adds a read surface only — it does not change the sync → curate → enrich → index → search write pipeline.
- The traceability prerequisite (a real `curatedDatasetPath` on every search hit) shipped earlier in 005 and is relied on, not re-derived here.
- The MCP server is hand-rolled and dependency-free (`zod` remains the only runtime dependency); adopting the official `@modelcontextprotocol/sdk` later would be a transport-only change.
- The semantic half of `mirror_search` is only as good as the configured embedder; the default `local-onnx` stub is unchanged and out of scope here.
- Out of scope: any write tool over MCP, a new schema or external contract, an alternate (HTTP/SSE) transport, and re-deriving the 005 traceability work.
