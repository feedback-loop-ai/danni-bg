---

description: "Task list for 007-read-api-mcp"
---

# Tasks: Stable Read API + Read-Only MCP Server

> **Status (2026-06-05): Implemented.** Every task below is complete and exercised by the test suite. This is the deliberate v1 follow-up named in the README/Constitution — the production-facing READ interface for downstream LLM-agent consumers — shipped on Track C in commit `d16c1a5`. Read-only: the store on disk remains the source of truth. The work landed before these spec/plan/tasks records were written, then these artifacts were reconciled against the green suite and the shipped source rather than re-derived task-by-task (research.md R1–R5).

**Input**: Design documents from `/specs/007-read-api-mcp/`
**Prerequisites**: plan.md, spec.md, research.md (R1–R5), data-model.md, quickstart.md. The traceability prerequisite — a real `curatedDatasetPath` on every search/entity hit — shipped earlier in 005.

**Tests**: Tests are MANDATORY for this feature (Constitution Principles VII, VIII: 100% line + branch coverage, TDD — write failing tests FIRST). This feature adds **no new portal endpoint, no new DB migration, and no new published read contract**: `mirror_info` reuses the existing `curated-dataset.schema.json`, `mirror_search` / `mirror_entity_search` reuse the existing `index-entry.schema.json`, and `read_resource` returns an **internal** `ResourceContent` shape (documented in the MCP tool table, not a published JSON Schema — research.md R1). So — exactly like 002, 003 and 005 — there is **no `contracts/` directory and no parity-matrix entry to add**; instead the mandatory tests are the `readResourceRows` off-disk unit tests (NDJSON / JSON object / GeoJSON / text / missing / malformed), the MCP handler tests (initialize / ping / tools/list / tools/call envelopes, notifications, unknown method, tool-error envelope), and the stdio-loop tests (buffered newline framing, trailing line without newline, malformed-line `-32700`).

## Implementation status

Complete. All tasks below are `[x]` — implemented and verified by the test suite (see the status note above).

**Organization**: Tasks are grouped by user story (US1 = P1 stable read API decoupled from the CLI, US2 = P1 agent-consumable over MCP, US3 = P2 protocol-correct + safe, US4 = P2 documented for consumers) to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Different files, no dependencies on incomplete tasks in the same phase
- **[Story]**: User-story phase tasks only (US1–US4)
- Every task includes an exact file path
- **TDD**: every test task is written and made to FAIL before the implementation task it guards

## Path Conventions

Single-project layout (inherited from 001, plan.md §Project Structure):
- New source: `src/read/dataset-view.ts`, `src/read/resource-rows.ts`, `src/read/index.ts`, `src/mcp/server.ts`, `src/cli/mcp.ts`
- Modified source: `src/cli/mirror-info.ts` (now imports `datasetView` from `src/read/`), `src/cli/danni.ts` (registers the `mcp` command)
- No new migration (no schema change); no `contracts/` directory (`read_resource` returns an internal `ResourceContent` shape; the other three tools reuse existing contracts — research.md R1)
- Docs: `docs/CONSUMERS.md` (new); `specs/001-egov-data-sync/contracts/cli.md` gains the `danni mcp` entry
- Tests: `tests/unit/read/resource-rows.test.ts`, `tests/unit/mcp/server.test.ts`, `tests/unit/cli/mcp.test.ts`; the two read tests repointed to `src/read/` are `tests/contract/curated-dataset.test.ts` and `tests/integration/offline-read.test.ts`
- Read-only deps: `src/store/repos/{curated-artifacts.ts,datasets.ts,resources.ts,organizations.ts,entities.ts,dataset-links.ts,translations.ts}`, `src/index/query.ts` (`search` / `searchByEntity`), `src/index/embedder.ts`, `src/index/embedders/factory.ts`, `src/config/loader.ts`, `src/store/db.ts`

---

## Phase 1: User Story 1 — Stable read API decoupled from the CLI (Priority: P1) 🎯 MVP

**Goal**: Extract the composed read path out of the `mirror-info` CLI into a stable in-process API under `src/read/`, so BOTH the CLI and the MCP server depend on it — never the reverse. `datasetView()` is the renamed `composeView` (the curated-dataset record); a new `readResourceRows()` reads a resource's curated rows/document/text straight off disk so a consumer never has to know the on-disk layout (FR-001, FR-002, research.md R2).

**Independent Test** (quickstart §1): `datasetView(db, datasetId, slo)` composes the full curated-dataset record (conforming to `curated-dataset.schema.json`) and `readResourceRows(db, storeRoot, datasetId, resourceId, {limit, offset})` returns paginated rows for a tabular artifact, a document for a single JSON/GeoJSON object, text for XML/text, and empty rows (`kind: null`) for an uncurated resource — all read off disk, with the `mirror-info` CLI now importing the same `datasetView`.

### Tests for User Story 1 (TDD — write FIRST, ensure they FAIL) ⚠️

- [x] T002 [P] [US1] Add `tests/unit/read/resource-rows.test.ts`: assert `readResourceRows` paginates a tabular (NDJSON) artifact (`rows`, `total`, `truncated`), returns a single JSON object as `document`, returns a GeoJSON object as `document`, returns XML/text as `text`, returns empty `rows` with `kind: null` for an uncurated/absent resource, throws when the resource is missing or belongs to another dataset, and throws a descriptive parse error on a malformed file (guards T004).

### Implementation for User Story 1

- [x] T001 [US1] Create `src/read/dataset-view.ts` (move `composeView` → `datasetView`, typed `Database`); rewire `src/cli/mirror-info.ts` to import it; repoint the two tests that imported `composeView` — `tests/contract/curated-dataset.test.ts` and `tests/integration/offline-read.test.ts` — at `src/read/dataset-view.ts` (FR-001, research.md R2).
- [x] T004 [US1] Add `readResourceRows(db, storeRoot, datasetId, resourceId, {limit, offset})` in `src/read/resource-rows.ts` (FR-002): join `CuratedArtifactsRepo.byDataset(datasetId)`, read the curated artifact off disk under `<storeRoot>/curated/`, and shape the result by kind — `tabular` (NDJSON) → paginated `rows`; a JSON-array → paginated `rows`; a single JSON/GeoJSON object → `document`; XML/text → `text`; uncurated/absent path → empty `rows` with `kind: null`. Throws if the resource is missing or in another dataset; throws a descriptive error on a malformed file. Satisfies the T002 unit tests. (Depends on T001.)
- [x] T003 [US1] Create `src/read/index.ts` re-exporting `datasetView` and `readResourceRows` (with their types) plus `search` / `searchByEntity` from `src/index/query.ts` — the single read substrate the CLI and MCP server both consume (FR-001). (Depends on T001, T004.)

**Checkpoint**: the read API lives in `src/read/`; `mirror-info` imports `datasetView` from it; `readResourceRows` reads any curated resource off disk. The dependency direction is correct (CLI → read API, never the reverse). MVP shippable here (stable, CLI-independent read surface).

---

## Phase 2: User Story 2 — Agent-consumable over MCP (Priority: P1)

**Goal**: An LLM agent points an MCP client at `danni mcp` and gets read-only tools to search, entity-search, inspect a dataset, and read a resource's rows. A dependency-free MCP server (`src/mcp/server.ts`) implements the small core the spec requires (`initialize` / `ping` / `tools/list` / `tools/call`) and exposes exactly four read-only tools, each zod-validating its arguments; NO write tools (sync/curate/index) are exposed (FR-003, FR-004, research.md R1, R4).

**Independent Test** (quickstart §2): a `tools/list` request returns exactly `mirror_search`, `mirror_entity_search`, `mirror_info`, `read_resource`; a `tools/call` for `mirror_info` returns the `datasetView` record wrapped in a `{content, isError:false}` envelope; `initialize` advertises the server's supported protocol version and `serverInfo`.

### Tests for User Story 2 (TDD — write FIRST, ensure they FAIL) ⚠️

- [x] T005 [P] [US2] Add `tests/unit/mcp/server.test.ts`: assert `handleRpc` answers `initialize` with the advertised `protocolVersion` + `capabilities.tools` + `serverInfo`, answers `ping` with `{}`, lists exactly the four read tools on `tools/list`, and routes `tools/call` for each tool through the read API into a `{content, isError:false}` envelope (guards T006).

### Implementation for User Story 2

- [x] T006 [US2] Create `src/mcp/server.ts` (FR-003, FR-004): the pure request handler `handleRpc(msg, ctx)` over JSON-RPC 2.0 (`initialize` advertising `PROTOCOL_VERSION` + `SERVER_INFO`, `ping`, `tools/list`, `tools/call`) plus the four zod-validated read-only tools (`mirror_search` → `search`, `mirror_entity_search` → `searchByEntity`, `mirror_info` → `datasetView`, `read_resource` → `readResourceRows`), each with a JSON-Schema `inputSchema`, and the `McpContext { db, storeRoot, embedder, freshnessSloSeconds }`. No write tools are exposed; the handler does no I/O so it is exercised directly in tests. Satisfies the T005 handler tests. (Depends on T003.)

**Checkpoint**: a `tools/list` over the handler returns exactly the four read tools and a `tools/call` for each routes through the read API; the server is read-only (SC-002, SC-003).

---

## Phase 3: User Story 3 — Protocol-correct + safe (Priority: P2)

**Goal**: JSON-RPC 2.0 over stdio is framed correctly and safely — notifications (no `id`) get NO response; an unknown method on a request returns `-32601`; tool failures are returned as `{isError:true}` result envelopes (not protocol errors); and stdout carries only JSON-RPC (logs go to stderr). The `danni mcp` CLI runs the newline-delimited stdin/stdout loop, buffered across chunks, with a trailing line lacking a newline still processed and a malformed line yielding `-32700` (FR-005, research.md R3, R5).

**Independent Test** (quickstart §3): a notification (a message with no `id`) produces no output; a request with an unknown method returns a `-32601` error; a `tools/call` whose tool throws returns a `{isError:true}` envelope (not a JSON-RPC error); a malformed input line returns `-32700`; a buffered stream split mid-line and a trailing line without a final newline are both processed exactly once.

### Tests for User Story 3 (TDD — write FIRST, ensure they FAIL) ⚠️

- [x] T007 [P] [US3] Extend `tests/unit/mcp/server.test.ts`: assert a notification (no `id`) returns `null` (no response), an unknown method on a request returns `-32601`, an unknown tool name and a throwing tool both return a `{content, isError:true}` envelope (protocol vs. tool errors correctly distinguished — SC-004), and add `tests/unit/cli/mcp.test.ts`: `dispatchLine` returns `-32700` on a malformed line, and `runStdio` buffers across chunks, processes a trailing line without a trailing newline, and writes nothing for a notification (guards T008).

### Implementation for User Story 3

- [x] T008 [US3] Create `src/cli/mcp.ts` (FR-005): `dispatchLine(line, ctx)` (parse one line as JSON-RPC, `-32700` on a malformed line, else `handleRpc`) and `runStdio(ctx, input?, write?)` — the buffered newline-delimited loop that decodes chunks, flushes one message per line, processes a trailing line without a newline, and writes nothing for a notification; `run(args)` loads config, opens the read-only DB, builds the embedder + context, and runs the loop, logging to stderr so stdout stays pure JSON-RPC. Register the `mcp` command in `src/cli/danni.ts`. Satisfies the T007 handler/stdio tests. (Depends on T006.)

**Checkpoint**: a real stdio session (`echo JSON-RPC | danni mcp`) returns spec-compliant responses for `initialize` / `tools/list` / `tools/call` (SC-001); notifications produce no response and protocol vs. tool errors are correctly distinguished (SC-004).

---

## Phase 4: User Story 4 — Documented for consumers (Priority: P2)

**Goal**: A downstream consumer can wire up the server and the on-disk mirror without reading the source: `docs/CONSUMERS.md` shows the MCP client config (command / args / cwd / env), the four tools + their I/O, and the on-disk layout + the contracts for direct consumption; the CLI reference gains the `danni mcp` entry (FR-006).

**Independent Test** (quickstart §4): `docs/CONSUMERS.md` documents an MCP client config block, the four tools (`mirror_search`, `mirror_entity_search`, `mirror_info`, `read_resource`) with inputs/outputs, and the on-disk layout + the `curated-dataset` / `index-entry` contracts; the CLI reference lists `danni mcp`.

### Implementation for User Story 4

- [x] T009 [US4] Add `docs/CONSUMERS.md` documenting the MCP client config (command / args / cwd / env), the four read tools with their I/O, and the on-disk layout + the `curated-dataset.schema.json` / `index-entry.schema.json` contracts for direct consumption; add the `danni mcp` entry to `specs/001-egov-data-sync/contracts/cli.md` (FR-006).

**Checkpoint**: a consumer can configure an MCP client and read the on-disk mirror straight from the docs; the CLI reference lists `danni mcp` (SC-001 documentation leg).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (US1)** → the read API extraction. T002 (test) written first; T001 (`datasetView` move + CLI rewire + test repoint) → T004 (`readResourceRows`) → T003 (`index.ts` barrel). Self-contained.
- **Phase 2 (US2)** → the MCP handler. T005 (test) written first; T006 (`server.ts`) depends on the read barrel (T003).
- **Phase 3 (US3)** → the stdio transport + CLI. T007 (tests) written first; T008 (`mcp.ts` loop + `danni.ts` registration) depends on the handler (T006).
- **Phase 4 (US4)** → consumer docs. T009 depends on the tool surface being final (T006, T008); no code dependency beyond that.

### User Story Dependencies

- **US1 (P1)** — the read API in `src/read/`. No dependency on other stories; the foundation both other surfaces depend on.
- **US2 (P1)** — the MCP handler; depends on US1's read barrel.
- **US3 (P2)** — the stdio transport + CLI; depends on US2's handler.
- **US4 (P2)** — consumer docs; depends on US2/US3's final tool surface.

### Parallel Opportunities

- **US1**: T002 (test) ∥ T001 may start together; T004 then T003 are sequential (T004 needs the new file from T001, T003 re-exports both).
- The three test tasks T002 / T005 / T007 (different test files) can be authored in parallel ahead of their implementations.
- Within a phase the implementation tasks are mostly sequential (read API → handler → transport), reflecting the deliberate one-directional dependency CLI/MCP → read API (research.md R2).

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in the same phase.
- [Story] label maps each task to its user story (US1–US4).
- Tests are MANDATORY and TDD (Constitution VII/VIII): write failing tests first, 100% line + branch coverage. There is **no new portal endpoint, no new migration and no new published read contract** here — `mirror_info` reuses `curated-dataset.schema.json`, `mirror_search` / `mirror_entity_search` reuse `index-entry.schema.json`, and `read_resource` returns the internal `ResourceContent` shape (documented in the MCP tool table) — so there is **no `contracts/` directory and no parity-matrix entry**, exactly like 002, 003 and 005 (research.md R1).
- The read API is the substrate the `mirror-info` CLI and the `danni mcp` server both depend on — never the reverse; `composeView` moved out of the CLI and became `datasetView` (research.md R2).
- A notification (no `id`) MUST get no response (JSON-RPC 2.0); a read server has no side effect to run on one, so it is accepted silently (research.md R3). `initialize` advertises the server's supported protocol version rather than echoing an arbitrary client value (research.md R4).
- Tool failures are returned as `{isError:true}` result envelopes (MCP convention); only protocol-level problems — unknown method / missing method (`-32601`), malformed line (`-32700`) — use JSON-RPC error codes (research.md R5).
- The server is dependency-free (hand-rolled, the project keeps `zod` as its only runtime dep); swapping in the official `@modelcontextprotocol/sdk` later is a transport-only change (research.md R1).
- Commit after each task or logical group; stop at any checkpoint to run `bun test --coverage` and validate before proceeding.
