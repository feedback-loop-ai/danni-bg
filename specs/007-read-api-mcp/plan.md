# Implementation Plan: Stable Read API + Read-Only MCP Server

**Branch**: `007-read-api-mcp` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-read-api-mcp/spec.md`
**Status**: Implemented (shipped in commit `d16c1a5`, Track C; verified by the test suite, 2026-06-05)

## Summary

v1 of danni-bg (Bun+TS CLI mirroring data.egov.bg via sync→curate→enrich→index→search over
SQLite) emitted machine-readable contracts and a CLI (`mirror-info`/`search`), but had **no
programmatic, agent-facing read surface**. The only composed read path — `composeView` —
was buried inside the `mirror-info` CLI command, so any other consumer would have had to depend
on the CLI (the wrong dependency direction) or on the live portal/write pipeline. This feature is
the deliberate v1 follow-up named in the README/Constitution: the production-facing **read**
interface for downstream LLM-agent consumers. It shipped four user stories:

1. **Stable read API decoupled from the CLI (US1, P1).** A new `src/read/` package owns the
   composed reads. `datasetView()` (`src/read/dataset-view.ts`, the renamed `composeView` over a
   typed `Database`) returns the curated-dataset record; a new `readResourceRows()`
   (`src/read/resource-rows.ts`) returns one resource's curated rows/document/text read straight
   off disk. `src/read/index.ts` re-exports both plus `search`/`searchByEntity`. The
   `mirror-info` CLI now *imports* `datasetView` (the dependency arrow inverted); the MCP server
   imports the same package. The read API never depends on the CLI or the MCP server.
2. **Agent-consumable over MCP (US2, P1).** A dependency-free MCP server (`src/mcp/server.ts`)
   exposes four read-only tools — `mirror_search`, `mirror_entity_search`, `mirror_info`,
   `read_resource` — each zod-validating its arguments. An LLM agent points an MCP client at
   `danni mcp` and gets exactly these read tools; no write tool (sync/curate/index) is exposed.
3. **Protocol-correct + safe (US3, P2).** The server speaks JSON-RPC 2.0 over newline-delimited
   stdio: `initialize` / `ping` / `tools/list` / `tools/call`. Notifications (no `id`) get **no**
   response; an unknown method on a request → `-32601`; a malformed line → `-32700`; tool
   failures are returned as `{content,isError:true}` envelopes (the MCP convention), **not** as
   protocol errors. `stdout` carries only JSON-RPC; logging goes to `stderr`.
4. **Documented for consumers (US4, P2).** `docs/CONSUMERS.md` documents the MCP client config
   (command/args/cwd/env), the four tools + their I/O, and the on-disk layout + contracts for
   direct consumption; the `danni mcp` entry was added to the CLI contract (`contracts/cli.md`).

This is **read-only**: the store on disk remains the source of truth, produced by the
sync→curate→enrich→index pipeline. The traceability prerequisite (a real `curatedDatasetPath`)
shipped earlier in 005.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, `noUncheckedIndexedAccess`, no `any` outside
type guards) — unchanged from 001.
**Primary Dependencies**:
- Runtime: Bun 1.x with `bun:sqlite` (existing `openDb` in `src/store/db.ts`); `Bun.stdin.stream()`
  for the MCP stdio transport.
- Repos: existing `DatasetsRepo`, `ResourcesRepo`, `OrganizationsRepo`, `CuratedArtifactsRepo`,
  `EntitiesRepo`, `DatasetLinksRepo`, `TranslationsRepo` (`src/store/repos/`) — `datasetView`
  composes them; `readResourceRows` joins `ResourcesRepo.get` + `CuratedArtifactsRepo.byDataset`.
- Index: existing `search`/`searchByEntity` and `buildEmbedder` (`src/index/`) — re-exported and
  composed, not changed.
- Validation: **Zod ^3.25.x — still the only runtime dependency.** Each MCP tool zod-validates its
  arguments at the boundary. **No new dependency** was added: the MCP server is hand-rolled rather
  than pulling in `@modelcontextprotocol/sdk` (R1).
- Testing: `bun test` + coverage per 001's Complexity Tracking decision (Vitest hangs under Bun
  with `bun:sqlite`).
- Lint/Format: Biome.

**Storage**: **No new table, no new migration, and no new on-disk blob layout.** `readResourceRows`
*reads* the existing curated artifacts under `store/curated/<...>` (paths taken from the
`curated_artifacts` rows); `datasetView` reads existing tables. Nothing is written.

**Testing**: `bun test` against in-memory/temp SQLite stores plus on-disk curated fixtures. The
`resource-rows` unit tests cover NDJSON/json/geojson/text/missing/malformed. The MCP `server.test.ts`
exercises `handleRpc` directly (it is a pure, I/O-free handler) for initialize/ping/tools-list/
tools-call, the notification path, unknown methods, and tool-error envelopes. The `cli/mcp.test.ts`
drives the buffered stdin loop (chunk splitting, trailing line without newline, malformed line). All
offline (Principle VI) — no network, no live model.

**Target Platform**: Linux server / macOS dev — unchanged from 001.

**Project Type**: Single project — CLI + library. The work adds two new top-level source packages
(`src/read/`, `src/mcp/`) and one CLI command (`src/cli/mcp.ts`).

**Performance Goals**: No new hot path. `readResourceRows` reads one artifact file and paginates in
memory under a hard `MAX_LIMIT` of 1000 rows; the MCP tools cap `limit` at 50 for search and 1000
for `read_resource`. The MCP server processes one line at a time off stdio.

**Constraints**:
- 100% line + branch coverage (Principle VIII): every artifact `kind` branch in `readResourceRows`
  (tabular / json-array / json-or-geojson-document / xml-or-text / uncurated-or-absent /
  malformed-throw / wrong-dataset-throw), every `handleRpc` method arm (including notification,
  unknown-tool, tool-error, missing-method, missing-method-field), and the `dispatchLine`
  `-32700` path are covered.
- Cyrillic preserved byte-exact (Principle X): `datasetView` passes original Bulgarian
  `title.bg`/`description.bg`/`label.bg` through unmodified; English helpers are clearly marked
  (`en`/`translator`/`translationConfidence`) and never replace originals.
- Read-only (SC-003): no tool mutates the store; the only writes are JSON-RPC responses to stdout.
- `stdout` MUST be pure JSON-RPC (FR-005): the CLI logs to `stderr`.

**Scale/Scope**: Confined to a read surface — two read modules, an MCP server, a CLI command, and
docs. No schema change, no migration, no new external contract.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence in this plan |
|---|-----------|--------|------------------------|
| I | AI-Native Development | ✅ PASS | The whole feature is the AI-native read surface: an LLM agent consumes the curated mirror over MCP. The tools surface *derived* records (curated-dataset + index entries + resource rows); no authoritative portal data is mutated (read-only, SC-003). |
| II | Spec-Driven Development | ✅ PASS | spec.md (WHAT, four user stories) → this plan + research.md (R1–R5, HOW) → tasks.md (T001–T006) → `bun test` (VALIDATION). |
| III | Contract-First API Design | ✅ PASS | **No new published contract and no `contracts/` directory.** Tool outputs reuse the existing schemas: `mirror_info`/`datasetView` → `curated-dataset.schema.json`; `mirror_search`/`mirror_entity_search` → `index-entry.schema.json` (SC-002). `ResourceContent` (the `read_resource` shape) is an *internal* type, documented in the MCP tool table in CONSUMERS.md, deliberately NOT a published JSON Schema (R5). The MCP wire surface and `danni mcp` are added to the existing CLI contract (`contracts/cli.md`). |
| IV | Operational Excellence | ✅ PASS | The MCP server keeps `stdout` pure JSON-RPC and logs to `stderr` (FR-005), so it is operable as a child process of an MCP client. Tool failures are returned as `{isError:true}` envelopes the agent can read, distinct from protocol errors (R5, SC-004). `--help` describes the command and points at docs/CONSUMERS.md. |
| V | Simplicity & YAGNI | ✅ PASS | The MCP server is hand-rolled against the small, stable read-only core (`initialize`/`ping`/`tools/list`/`tools/call`) rather than adding `@modelcontextprotocol/sdk` — zod stays the only runtime dep (R1). The read API is an *extraction* of existing logic (`composeView`→`datasetView`), not new behavior (R2). No new table, no migration, no new contract file. |
| VI | Fast Feedback Loops | ✅ PASS | `handleRpc` is a pure, I/O-free handler tested directly; the stdio loop is tested with an injected `AsyncIterable` + `write` sink (no real stdio); `readResourceRows` is tested against on-disk fixtures. Fully offline. `bun test` stays fast. |
| VII | Type Safety & Validation | ✅ PASS | `CuratedDatasetView` and `ResourceContent` are explicit interfaces; `JsonRpcRequest`/`JsonRpcResponse`/`ToolDef`/`McpContext` are typed. Every tool zod-validates its arguments before touching the store (FR-004). No `any` outside the JSON-RPC parse boundary; `datasetView` takes a typed `Database`. |
| VIII | 100% Test Coverage & Endpoint Parity | ✅ PASS | TDD per module: the read tests (T001–T002) precede/accompany the extraction; the handler tests (T004) and stdio-loop tests (T005) cover every protocol branch. New suites: `tests/unit/read/resource-rows.test.ts`, `tests/unit/mcp/server.test.ts`, `tests/unit/cli/mcp.test.ts`; the two existing tests that imported `composeView` were repointed to `src/read/`. |
| IX | Data Freshness & Sync Integrity | ✅ PASS | Read-only — no sync path is touched. `datasetView` and the MCP tools propagate the existing freshness fields (`isStale`, `freshnessSloSeconds`, `lastSyncedAt`) so the agent sees staleness; they do not refresh from the live portal (the store is the source of truth). |
| X | Bulgarian-Locale Awareness | ✅ PASS | `datasetView` returns original Bulgarian `title.bg`/`description.bg`/entity `label.bg` byte-exact; English helpers are clearly separate (`en`/`translator`/`translationConfidence`) and never overwrite originals. `read_resource` returns curated content verbatim off disk. `mirror_search` accepts a `bg`/`en`/`auto` language hint. |
| XI | Respectful Crawling | ✅ PASS | N/A by construction — the read surface never touches the network. The whole point (US2) is that an agent reads the curated mirror *instead of* hitting the live portal. |

**Result**: All gates PASS. No new violations and no new Complexity Tracking entries beyond the
inherited `bun test` decision (001). The hand-rolled MCP server is recorded as a deliberate
simplicity choice (R1), not a complexity exception: swapping in the official SDK later is a
transport-only change.

## Project Structure

### Documentation (this feature)

```text
specs/007-read-api-mcp/
├── plan.md              # This file
├── research.md          # Phase 0 output (R1–R5)
├── data-model.md        # CuratedDatasetView + ResourceContent + MCP wire types
├── quickstart.md        # Real stdio session + SC checklist
├── spec.md
└── tasks.md             # Created by /speckit-tasks
```

**No `contracts/` directory** — like 002, 003, and 005. This feature publishes no new external
JSON Schema: `mirror_info` reuses `curated-dataset.schema.json` and `mirror_search`/
`mirror_entity_search` reuse `index-entry.schema.json` (both owned by 001); `read_resource`
returns the *internal* `ResourceContent` shape, documented in the MCP tool table rather than as a
published schema (R5). The `danni mcp` command and its tool surface are appended to the existing
CLI contract (`specs/001-egov-data-sync/contracts/cli.md`).

### Source Code (repository root)

Files to **add**:

```text
src/read/
├── dataset-view.ts      # NEW — datasetView(db, datasetId, freshnessSloSeconds): CuratedDatasetView
│                        #   (the renamed composeView, typed Database; composes datasets + orgs +
│                        #   curated_artifacts + entities + dataset_links + translations)
├── resource-rows.ts     # NEW — readResourceRows(db, storeRoot, datasetId, resourceId, {limit,offset})
│                        #   reads the curated artifact off disk → tabular(NDJSON)/JSON-array → rows;
│                        #   single JSON/GeoJSON → document; xml/text → text; uncurated/absent →
│                        #   empty rows (kind null); throws on wrong/missing dataset or malformed file
└── index.ts             # NEW — re-export datasetView, readResourceRows, search, searchByEntity

src/mcp/
└── server.ts            # NEW — McpContext + handleRpc (initialize/ping/tools/list/tools/call;
                         #   notification→null; unknown→-32601) + the four zod-validated read tools;
                         #   tool errors → {content,isError:true}. Dependency-free, pure handler.

src/cli/
└── mcp.ts               # NEW — dispatchLine (malformed line → -32700) + runStdio (buffered
                         #   newline loop; trailing line w/o newline processed) + run() wiring config

docs/
└── CONSUMERS.md         # NEW — MCP client config (command/args/cwd/env) + the four tools + I/O +
                         #   the on-disk layout + contracts for direct consumption

tests/unit/read/
└── resource-rows.test.ts   # NEW — NDJSON / json / geojson / text / missing / malformed

tests/unit/mcp/
└── server.test.ts          # NEW — handleRpc per method + notification + unknown method + tool-error

tests/unit/cli/
└── mcp.test.ts             # NEW — dispatchLine -32700 + buffered/trailing-line stdio loop
```

Files to **modify**:

```text
src/cli/mirror-info.ts              # Import datasetView from src/read/ (was the inline composeView);
                                    #   dependency arrow inverted — CLI now depends on the read API
src/cli/danni.ts                    # Register the `mcp` command (help line + lazy import → m.run)
specs/001-egov-data-sync/contracts/cli.md   # Add the `danni mcp` entry: stdio JSON-RPC, the four
                                    #   read-only tools, and the reused contract shapes
tests/contract/curated-dataset.test.ts      # Repoint import to src/read/dataset-view.ts (datasetView)
tests/integration/offline-read.test.ts      # Repoint import to src/read/dataset-view.ts (datasetView)
```

Files **read but not modified** (depended upon):

```text
src/store/repos/{datasets,resources,organizations,curated-artifacts,entities,dataset-links,translations}.ts
src/store/db.ts                     # openDb (loadVec:false for the read server)
src/index/query.ts                  # search / searchByEntity / IndexEntry / QueryOptions / Lang (re-exported)
src/index/embedder.ts               # Embedder interface (McpContext.embedder)
src/index/embedders/factory.ts      # buildEmbedder (CLI wiring of the read server's embedder)
src/config/loader.ts                # loadConfig (store.root, freshnessSloSeconds, enrichment.embedder)
```

**Structure Decision**: Single-project layout (inherited from 001). The composed reads live in a new
`src/read/` package so the `mirror-info` CLI and the `src/mcp/` server both **depend on** it —
`composeView` previously lived inside the CLI, which was the wrong direction (R2). The MCP server is
split into a pure, I/O-free handler (`src/mcp/server.ts`) and a thin stdio transport in the CLI
(`src/cli/mcp.ts`), so the protocol logic is testable without real stdin/stdout and the transport can
later be swapped for the official SDK without touching the handler (R1).

## Implementation Phases

Ordered, TDD-first (the new test precedes/accompanies the code it guards, per Principle VIII). The
read-API extraction (Phase 1) is the foundation both later consumers depend on.

**Phase 0 — Research (done).** R1–R5 in research.md resolve: R1 hand-roll a minimal, spec-compliant
MCP server (the read-only `initialize`/`tools/list`/`tools/call`/`ping` core is small and stable,
zod stays the only runtime dep, and the official SDK is a transport-only swap later) over adding
`@modelcontextprotocol/sdk` (rejected for dependency weight); R2 extract the read API into
`src/read/` so the CLI and MCP server both depend on it (`datasetView` is the renamed `composeView`,
which had been buried in the CLI — wrong direction); R3 notifications (no `id`) MUST get no response,
and a read server has no side effect to run on one, so any notification is accepted silently; R4
`initialize` advertises the server's supported protocol version rather than echoing an arbitrary
client value; R5 tool failures are returned as `{isError:true}` result envelopes (MCP convention),
and only protocol-level problems (unknown/missing method) use JSON-RPC error codes.

**Phase 1 — Stable read API (US1, P1).**
1. **T001** Create `src/read/dataset-view.ts`: move `composeView` → `datasetView` over a typed
   `Database`; rewire `src/cli/mirror-info.ts` to import it; repoint the two existing tests that
   imported `composeView` (`tests/contract/curated-dataset.test.ts`,
   `tests/integration/offline-read.test.ts`) to `src/read/`.
2. **T002** Create `src/read/resource-rows.ts`: `readResourceRows(db, storeRoot, datasetId,
   resourceId, {limit,offset})` reading the curated artifact off disk — tabular(NDJSON)/JSON-array
   → paginated `rows`; single JSON/GeoJSON object → `document`; xml/text → `text`; uncurated/absent
   → empty `rows` (`kind: null`); throw if the resource is missing or in another dataset; throw a
   descriptive parse error on a malformed file. Add `tests/unit/read/resource-rows.test.ts`
   (NDJSON/json/geojson/text/missing/malformed).
3. **T003** Create `src/read/index.ts` re-exporting `datasetView`, `readResourceRows`, `search`,
   `searchByEntity`.

**Phase 2 — Agent-consumable MCP server (US2/US3, P1/P2).**
4. **T004** Create `src/mcp/server.ts`: `McpContext{db, storeRoot, embedder, freshnessSloSeconds}`,
   the typed JSON-RPC wire types, and `handleRpc` (`initialize` advertising `PROTOCOL_VERSION` per R4;
   `ping`; `tools/list`; `tools/call`; notification → `null` per R3; unknown method → `-32601`; tool
   failure → `{content,isError:true}` per R5) wired to the four zod-validated read-only tools
   (`mirror_search`, `mirror_entity_search`, `mirror_info`, `read_resource`) — no write tool exposed.
   Add `tests/unit/mcp/server.test.ts` (each method + notification + unknown method + tool-error).

**Phase 3 — stdio transport + CLI command (US3, P2).**
5. **T005** Create `src/cli/mcp.ts`: `dispatchLine` (JSON.parse → `-32700` on a malformed line) and
   `runStdio` (buffered newline loop across chunks, trailing line without a newline processed,
   notifications produce no output, responses written one-per-line; logging to `stderr` so `stdout`
   is pure JSON-RPC); register the `danni mcp` command in `src/cli/danni.ts`. Add
   `tests/unit/cli/mcp.test.ts` (the `-32700` path + buffered/trailing-line loop with an injected
   source and `write` sink).

**Phase 4 — Consumer documentation (US4, P2).**
6. **T006** Write `docs/CONSUMERS.md`: the MCP client config (command/args/cwd/env), the four tools
   with their arguments + returns, and the on-disk layout + contracts for direct consumption; add the
   `danni mcp` entry to `specs/001-egov-data-sync/contracts/cli.md`.

**Phase 5 — Gates.** Full suite green with the additions (the three new unit suites plus the two
repointed tests); Biome lint + typecheck clean; the parity-matrix and migrate-smoke gates pass
(neither is affected — no new portal endpoint, no new migration). SC-001 verified by a real stdio
session (`echo` JSON-RPC piped to `danni mcp` returns spec-compliant `initialize` / `tools/list` /
`tools/call` responses).
