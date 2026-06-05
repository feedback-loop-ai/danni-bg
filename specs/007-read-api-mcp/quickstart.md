# Quickstart — Stable Read API + Read-Only MCP Server (007)

> **Audience**: a consumer (or reviewer) verifying that the curated mirror has a
> stable, in-process read API decoupled from the CLI, and that an LLM agent can
> search, inspect and pull curated datasets over a read-only MCP server without
> touching the live portal or the write pipeline. This is a RETROFIT of
> already-shipped work (**Status: Implemented**, 2026-06-05, commit `d16c1a5`);
> the steps below confirm the shipped behavior, not new work to enable. No new
> migration; no new external JSON-Schema contract — `mirror_info` reuses
> `curated-dataset.schema.json`, `mirror_search` / `mirror_entity_search` reuse
> `index-entry.schema.json`, and `read_resource` returns an internal
> `ResourceContent` shape documented in the tool table.

All commands run from the repo root with Bun installed.

## 0. Green gate (run this first and last)

The whole feature was added under a green suite. Confirm the three gates pass
before and after exercising the individual surfaces:

```bash
bun test          # expect: 781 pass, 0 fail (was 779 at d16c1a5; 2 added downstream)
bun run lint      # biome check . — expect: clean
bun run typecheck # tsc --noEmit — expect: clean
```

`bun test` also runs the constitution gates (parity-matrix + migrate-smoke);
they stay green because this feature consumes no new endpoint and ships no
migration. The read API and MCP server keep `zod` as the only runtime dep — the
server is hand-rolled, not `@modelcontextprotocol/sdk` (R1).

## 1. Verify the read API is decoupled from the CLI (FR-001 · US1)

`composeView` was buried inside the `mirror-info` command — the wrong dependency
direction. It is now `datasetView` in `src/read/dataset-view.ts`, joined by the
new `readResourceRows` (`src/read/resource-rows.ts`), and `src/read/index.ts`
re-exports both plus `search` / `searchByEntity`. The CLI now DEPENDS ON the read
API: `src/cli/mirror-info.ts` imports `datasetView`, never the reverse (R2).

```bash
bun test tests/unit/read/resource-rows.test.ts
# expect: 9 pass — tabular NDJSON pagination (total/truncated), a single JSON
#   document, a JSON array as rows, geojson object vs array, text verbatim,
#   uncurated → kind:null + empty rows, missing/cross-dataset resource → throws
#   /not found/, malformed JSON → throws /failed to parse curated artifact/
```

The two tests that imported `composeView` were repointed to `src/read/`:

```bash
bun test tests/contract/curated-dataset.test.ts tests/integration/offline-read.test.ts
# expect: 2 pass —
#   contract.curated-dataset: datasetView(db,'d1',86400) validates against
#     curated-dataset.schema.json
#   integration.offline-read (SC-006): the read paths succeed with zero portal
#     HTTP egress
```

**Acceptance check (FR-001/FR-002)**: `readResourceRows(db, storeRoot, datasetId,
resourceId, {limit,offset})` reads the curated artifact off disk —
tabular(NDJSON)/JSON-array → paginated `rows`; a single JSON/GeoJSON object →
`document`; XML/text → `text`; uncurated/absent → empty `rows` with `kind: null`;
it throws if the resource is missing or in another dataset, and throws a
path-bearing error on a malformed file.

## 2. Verify the MCP request handler (FR-003, FR-004, FR-005 · US2/US3)

`handleRpc` in `src/mcp/server.ts` is the pure (no-I/O) JSON-RPC 2.0 handler;
`dispatchLine` / `runStdio` in `src/cli/mcp.ts` wrap it in the newline-delimited
stdio loop. Both are exercised offline:

```bash
bun test tests/unit/mcp/server.test.ts tests/unit/cli/mcp.test.ts
# expect: server — initialize advertises serverInfo + protocolVersion 2024-11-05
#   (does NOT echo the client value, R4); tools/list advertises exactly the four
#   read tools and TOOLS.length === 4; tools/call for mirror_info / mirror_search
#   / mirror_entity_search / read_resource (paginated); tool failures (unknown
#   dataset, bad args, unknown tool, missing resource) come back isError:true;
#   unknown method → -32601; notifications (incl. initialize-as-notification) →
#   null; ping → {}
# expect: cli — dispatchLine returns -32700 (id null) on malformed JSON; runStdio
#   frames messages across chunk boundaries, emits nothing for a notification, and
#   processes a final line with no trailing newline
```

**Acceptance check (FR-003/FR-005)**: notifications (no `id`) get NO response;
an unknown method on a request returns `-32601`; a malformed line returns
`-32700`; tool failures are returned as `{content, isError:true}` envelopes (R5),
never as protocol errors; the loop buffers across chunks and processes a trailing
unterminated line.

## 3. Run a real stdio session (SC-001 · US2/US3)

A live `echo JSON-RPC | danni mcp` session must return spec-compliant responses.
`danni mcp` logs to stderr so stdout carries only JSON-RPC (FR-005); a populated
store is not needed for `initialize` / `tools/list` / `ping`.

```bash
printf '%s\n%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"ping"}' \
  | bun run danni mcp 2>/dev/null
```

Expect exactly THREE response lines (the notification produces none):

- `id:1` → `result.protocolVersion === "2024-11-05"`, `result.serverInfo ===
  {name:"danni-bg", version:"0.1.0"}`, `result.capabilities === {tools:{}}`;
- `id:2` → `result.tools` lists `mirror_search`, `mirror_entity_search`,
  `mirror_info`, `read_resource`, each with a JSON-Schema `inputSchema`;
- `id:3` → `result === {}`.

`danni mcp --help` prints the one-screen summary (the four tools + a pointer to
`docs/CONSUMERS.md`) without opening the store. The command runs until stdin
closes; `danni.ts` registers it alongside `sync` / `curate` / `index` / `search` /
`eval` / `schedule` / `mirror-info`.

**Acceptance check (SC-001/SC-003/SC-004)**: the session returns compliant
responses for `initialize` / `tools/list` / `tools/call` / `ping`; the
notification is silently accepted (R3); only read tools are exposed (no
sync/curate/index write tools), so no tool mutates the store.

## 4. Verify the tool outputs reuse the existing contracts (SC-002)

The four tools wrap the read API and are zod-validated; their payloads are the
shipped contract shapes (FR-004). Against a populated store (from the 001
quickstart):

```bash
# mirror_info → a curated-dataset.schema.json record
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"mirror_info","arguments":{"datasetId":"<dataset_id>"}}}' \
  | bun run danni mcp 2>/dev/null
# result.content[0].text is JSON: { datasetId, slug, sourceUrl, publisher, title{bg,en},
#   resources[…], entities[…], links[…], freshness } — the same record as
#   `danni mirror-info <id> --json`.

# mirror_search / mirror_entity_search → index-entry.schema.json hits
printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mirror_search","arguments":{"query":"бюджет","limit":5}}}' \
  | bun run danni mcp 2>/dev/null
# result.content[0].text is JSON: ranked IndexEntry[] with sourceUrl +
#   curatedDatasetPath for one-hop traceability.

# read_resource → the internal ResourceContent shape (rows/document/text + pagination)
printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_resource","arguments":{"datasetId":"<dataset_id>","resourceId":"<resource_id>","limit":100,"offset":0}}}' \
  | bun run danni mcp 2>/dev/null
# result.content[0].text is JSON: { datasetId, resourceId, kind, curatedPath,
#   rows[], document?, text?, total, limit, offset, truncated }.
```

The same `datasetView` powers `danni mirror-info <id> --json`, so the CLI and the
MCP tool emit byte-identical curated-dataset records — confirming the single read
substrate (US1):

```bash
bun run danni mirror-info <dataset_id> --json
# matches mirror_info's payload (both call datasetView).
```

**Acceptance check (SC-002)**: `mirror_info` → `curated-dataset.schema.json`;
`mirror_search` / `mirror_entity_search` → `index-entry.schema.json`;
`read_resource` → the documented `ResourceContent` shape (not a published JSON
Schema).

## 5. Verify the consumer docs (FR-006 · US4)

`docs/CONSUMERS.md` is the entry point for machine consumers: the MCP client
config snippet (`command` / `args` / `cwd` / `env`), the four tools + their I/O,
and the on-disk layout + contracts for direct file-system consumption.
`specs/001-egov-data-sync/contracts/cli.md` gains the `danni mcp` entry.

```bash
bun run danni --help
# the COMMANDS list includes: mcp — Run a read-only MCP server over stdio
#   (for LLM-agent consumers)
```

Read the two docs to confirm they describe the shipped surface:

- `docs/CONSUMERS.md` — section 1 (`danni mcp` config + the four-tool table),
  section 2 (the `store/` layout + the `specs/001-…/contracts/` schemas);
- `specs/001-egov-data-sync/contracts/cli.md` — the `## danni mcp` block (the
  four tools, contract reuse, stderr-only logging, "runs until stdin closes").

**Acceptance check (FR-006)**: a consumer can wire an MCP client to `danni mcp`
from `docs/CONSUMERS.md` alone, and can read the curated files directly using the
documented layout + contracts.

## Success-criteria checklist (from spec §Success Criteria)

- **SC-001**: step 3 — a real `echo JSON-RPC | danni mcp` stdio session returns
  spec-compliant responses for `initialize` / `tools/list` / `tools/call` / `ping`.
- **SC-002**: step 4 — tool outputs reuse the existing contracts: `mirror_info`
  → `curated-dataset.schema.json`; `mirror_search` / `mirror_entity_search` →
  `index-entry.schema.json`.
- **SC-003**: steps 2 + 3 — the server is read-only; only the four read tools are
  exposed and no tool mutates the store.
- **SC-004**: steps 2 + 3 — notifications produce no response and protocol errors
  (`-32601` / `-32700`) are correctly distinguished from tool errors
  (`isError:true`).
