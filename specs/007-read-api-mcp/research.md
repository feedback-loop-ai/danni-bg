# Phase 0 Research — 007-read-api-mcp

**Date**: 2026-06-05
**Status**: Implemented. Records the decisions behind the shipped, verified work.

This feature is a **retrofit**: the stable read API and the read-only MCP server were built and
verified (779 pass / 0 fail, lint + typecheck clean, parity-matrix + migrate-smoke gates green)
*before* this artifact was written. It is the deliberate v1 follow-up named in the README and the
Constitution — the production-facing **read** interface for downstream LLM-agent consumers. v1 had
emitted machine-readable contracts and a CLI (`mirror-info` / `search`) but exposed **no programmatic,
agent-facing read surface**; the only composed read path (`composeView`) was buried inside the
`mirror-info` CLI command. This track extracts that path into a stable in-process API and exposes it
over a read-only MCP server, so an LLM agent can search, inspect and pull curated datasets without
depending on the live portal or the write pipeline. The traceability prerequisite — a real
`curatedDatasetPath` on every search hit — shipped earlier in 005.

There is **no new migration** and **no `contracts/` directory** (like 002, 003, and 005): the read
API is composed over the existing store at query time, and the tool outputs reuse the already-published
`curated-dataset.schema.json` and `index-entry.schema.json`. `read_resource` returns an *internal*
`ResourceContent` shape that is documented in the MCP tool table rather than published as a new external
JSON Schema. The store on disk remains the source of truth — every tool is read-only. Each decision
below is in the canonical **Decision / Rationale / Alternatives considered** form and is grounded in the
code actually read (`src/read/{dataset-view,resource-rows,index}.ts`, `src/mcp/server.ts`,
`src/cli/{mcp,mirror-info,danni}.ts`, `docs/CONSUMERS.md`, and the three new test files
`tests/unit/{read/resource-rows,mcp/server,cli/mcp}.test.ts`). Shipped in commit `d16c1a5` (Track C).

---

## R1 — Hand-roll a minimal, spec-compliant MCP server rather than add `@modelcontextprotocol/sdk`

**Decision**: `src/mcp/server.ts` is a **dependency-free** Model Context Protocol server. It implements
exactly the small, stable core the read surface needs — `initialize`, `ping`, `tools/list`,
`tools/call` — over newline-delimited JSON-RPC 2.0, with its own `JsonRpcRequest` / `JsonRpcResponse`
wire types and a plain `ToolDef[]`. The only runtime dependency it leans on is **zod** (already the
project's sole runtime dep), used to validate each tool's arguments. No `@modelcontextprotocol/sdk` is
added. The module is written as a *pure request handler* (`handleRpc(msg, ctx)`, no I/O) so the
transport (`src/cli/mcp.ts`) is a thin, separately-testable shell around it.

**Rationale**: The read-only surface is small and slow-moving: four read tools plus the four lifecycle
methods. The official SDK would bring its own transport, capability machinery, and dependency tree to
cover protocol breadth this server deliberately does not use (no resources, no prompts, no sampling, no
write tools). Keeping the server hand-rolled preserves the project's lean-dependency ethos (zod only)
and keeps the protocol logic auditable in one ~240-line file. Because the SDK's value is almost entirely
in the *transport* (stdio framing, content-type negotiation) and `handleRpc` is already isolated from
I/O, swapping the official SDK in later — if richer protocol features are ever needed — is a
transport-only change that does not touch the tool definitions or the read API beneath them.

**Alternatives considered**:
- *Add `@modelcontextprotocol/sdk`*: rejected for the dependency weight. The surface is small enough
  that the SDK's machinery is mostly unused, and pulling it in would trade the auditable single-file
  handler and the zod-only footprint for protocol features the read server has no use for.
- *Implement the full MCP method set (resources, prompts, sampling)*: rejected — out of scope (Principle
  V / YAGNI). The four tools plus `initialize`/`ping`/`tools/list`/`tools/call` are all an agent needs to
  search, inspect, and pull curated datasets; anything beyond `tools/call` would be dead surface on a
  read-only server.

---

## R2 — Extract the read API into `src/read/` so the CLI *and* the MCP server depend on it

**Decision**: A new `src/read/` package is the single read substrate. `datasetView(db, datasetId,
freshnessSloSeconds)` (`src/read/dataset-view.ts`) is the renamed `composeView` — the curated-dataset
record composing datasets + organizations + curated artifacts + entities + links + translations into one
`CuratedDatasetView` that conforms to `curated-dataset.schema.json`. A new `readResourceRows(...)`
(`src/read/resource-rows.ts`) sits beside it, and `src/read/index.ts` re-exports both plus
`search` / `searchByEntity` (re-exported from `src/index/query.ts`). `src/cli/mirror-info.ts` now
**imports** `datasetView` from `src/read/` (it no longer owns the composition), and `src/mcp/server.ts`
imports the same functions. The dependency arrow points one way only: CLI → read, MCP → read; never the
reverse.

**Rationale**: Before this track the only composed read path lived *inside* the `mirror-info` CLI
command — the wrong direction, since a CLI command is a process entry point, not a reusable library. Any
second consumer (here, the MCP server) would have had to either depend on a CLI module or duplicate the
composition. Hoisting the composition into `src/read/` makes it the shared substrate both entry points
consume, so the curated-dataset record is composed in exactly one place and the MCP tool, the
`mirror-info` CLI, and any future consumer all see an identical shape. The doc comment on
`CuratedDatasetView` records this contract explicitly: it "is the read substrate the `danni mirror-info`
CLI and the `danni mcp` server both consume — never the other way around."

**Alternatives considered**:
- *Have the MCP server import the composition from `cli/mirror-info.ts`*: rejected — it inverts the
  dependency direction (server depending on a CLI command), couples the agent surface to CLI flag-parsing
  and exit-code concerns, and leaves the read logic stranded in an entry point.
- *Duplicate `composeView` into the MCP server*: rejected — two copies of the curated-dataset
  composition would drift, which is precisely the failure mode 005's `portal-sync` consolidation was
  written to avoid. One substrate, two thin consumers.

---

## R3 — Notifications (no `id`) MUST get no response

**Decision**: In `handleRpc`, a message whose `id` member is `undefined` is treated as a JSON-RPC 2.0
**notification** and returns `null` — the caller writes nothing for it. The stdio loop honors this: the
`flush` step only calls `write(...)` when `dispatchLine` returns a non-null response. A notification such
as `notifications/initialized` is therefore accepted silently, with no output on stdout.

**Rationale**: JSON-RPC 2.0 mandates that a notification (a request with no `id`) MUST NOT be answered.
A *read* server has no side effects to run on a notification — there is nothing to acknowledge, queue, or
mutate — so the correct and complete behavior is to accept it and stay silent. This was a hardening fix
from the adversarial review of the diff: an earlier revision answered `initialize` / `ping` /
`tools/list` *notifications*, which is a protocol violation; the `id === undefined` short-circuit at the
top of `handleRpc` fixes it. The server test asserts a notification yields no response, satisfying
SC-004.

**Alternatives considered**:
- *Reply to every message, including notifications*: rejected — it violates JSON-RPC 2.0 (the exact bug
  the review caught) and would put unsolicited frames on stdout that a strict client could reject.
- *Distinguish notifications by method name (a `notifications/*` prefix)*: rejected — the spec defines a
  notification by the **absence of `id`**, not by method naming; keying off the prefix would
  misclassify any future notification method and is not what the protocol says.

---

## R4 — `initialize` advertises the server's supported protocol version

**Decision**: The `initialize` result returns a fixed `protocolVersion` constant
(`PROTOCOL_VERSION = '2024-11-05'`), the server's own supported version, alongside
`capabilities: { tools: {} }` and a static `serverInfo` (`{ name: 'danni-bg', version: '0.1.0' }`). It
**does not** echo whatever `protocolVersion` the client sent in its `initialize` params.

**Rationale**: The handshake exists for the server to declare what *it* supports so the client can decide
whether it can talk to it. Echoing the client's value would be meaningless — it would claim support for
whatever the client asked for, including versions this server does not actually implement, defeating the
point of version negotiation. Advertising the one version the server actually speaks is the honest,
spec-correct answer. This too was a hardening fix from the diff review (an earlier revision echoed the
client value). The server test asserts the advertised version is the server constant regardless of the
client's request.

**Alternatives considered**:
- *Echo the client-supplied `protocolVersion`*: rejected — it falsely advertises support for arbitrary
  versions and was the exact behavior the review corrected.
- *Negotiate a version range*: rejected — over-engineering for a server that implements exactly one
  protocol version (Principle V / YAGNI). A single advertised constant is sufficient and unambiguous; a
  range can be introduced if and when a second supported version actually exists.

---

## R5 — Tool failures are `{ isError: true }` envelopes; only protocol problems use JSON-RPC error codes

**Decision**: Two distinct failure channels. A **tool** failure — bad arguments (zod rejects them), an
unknown tool name, an unknown dataset, a missing resource, a malformed artifact — comes back as a
*successful* JSON-RPC result whose body is `{ content: [{ type: 'text', text: <message> }], isError:
true }`. `tools/call` wraps every `tool.run(...)` in a `try/catch` to convert any thrown error into that
envelope, and an unknown tool name produces the same `isError: true` shape rather than a JSON-RPC error.
Only **protocol-level** problems use JSON-RPC `error` codes: an unknown method on a request → `-32601`
(`method not found`), a request missing its `method` member → `-32600`, and a line that is not valid JSON
→ `-32700` (raised in `dispatchLine`, `src/cli/mcp.ts`).

**Rationale**: This is the MCP convention, and it draws the right line for an agent consumer. A failed
tool call is *data the model should see and reason about* — "that dataset does not exist," "the file is
malformed" — not a transport fault; surfacing it as `isError: true` lets the agent recover or retry
inside the same session. A genuine protocol fault (the client sent something the JSON-RPC layer cannot
route or parse) is a different category and belongs in the `error` member with the standard code. Keeping
these separate means a tool error never crashes or aborts the session, while a real protocol violation is
still reported unambiguously. The `CONSUMERS.md` tool table states this contract to consumers, and the
server test asserts both halves (a tool error yields `isError: true`; an unknown method yields `-32601`),
satisfying SC-004.

**Alternatives considered**:
- *Return tool failures as JSON-RPC errors*: rejected — it conflates "the data you asked for is not
  there" with "the protocol broke," denies the model the failure text in a form it can act on, and (for
  some clients) tears down the call as a transport fault rather than a recoverable result.
- *Swallow tool failures and return empty content*: rejected — it hides the cause from the agent, which
  cannot then distinguish "no results" from "your arguments were wrong," and would mask the descriptive,
  path-bearing parse error that `readResourceRows` raises on a malformed curated artifact.
