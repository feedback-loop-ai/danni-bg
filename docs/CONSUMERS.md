# Consuming the danni-bg mirror

danni-bg is built for **machine consumers** — LLM agents, analytics jobs, retrieval systems — that
want Bulgarian open-government data without depending on the live portal. There are two ways in:

1. **The MCP server** (`danni mcp`) — for LLM agents. Read-only, over stdio.
2. **Directly off disk** — the curated files + SQLite store, with machine-readable contracts.

Both are **read-only**: the store on disk is the source of truth, produced by the sync→curate→
enrich→index pipeline. Every search result carries a `sourceUrl` (back to data.egov.bg) and a
`curatedDatasetPath` (under `store/curated/`) for one-hop traceability (FR-013).

## 1. MCP server (`danni mcp`)

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server over stdio
(newline-delimited JSON-RPC 2.0). Point any MCP client at it:

```jsonc
// claude_desktop_config.json / mcp.json
{
  "mcpServers": {
    "danni-bg": {
      "command": "bun",
      "args": ["run", "danni", "mcp"],
      "cwd": "/path/to/danni-bg",                       // so ./store resolves; or…
      "env": { "DANNI_CONFIG": "/path/to/danni.config.json" }  // …point at an absolute store.root
    }
  }
}
```

(Equivalently, run the bin directly: `command: "/path/to/danni-bg/bin/danni"`, `args: ["mcp"]`.)

### Tools

| Tool | Arguments | Returns |
|---|---|---|
| `mirror_search` | `query` (string, bg/en), `lang?` (`bg`\|`en`\|`auto`), `limit?` (1–50, default 5) | Ranked `IndexEntry[]` — `datasetId`, `title` (bg/en), `publisher`, `matchKind`, `sourceUrl`, `curatedDatasetPath`, `freshness`. |
| `mirror_entity_search` | `entityId` (string), `limit?` (1–50, default 50) | Datasets linked to that entity, with the matched entity label. |
| `mirror_info` | `datasetId` (string) | The full curated-dataset record: title/description (bg+en), publisher, resources (with `curatedPath` + schema), entities, cross-dataset links, freshness. |
| `read_resource` | `datasetId`, `resourceId`, `limit?` (1–1000, default 100), `offset?` | The resource's curated content: paginated `rows` (tabular/NDJSON or JSON array), a single `document` (JSON/GeoJSON object), or `text` (XML/text). |

Tool failures (unknown dataset, bad arguments) come back as a result with `isError: true` and a
message — they do not crash the session. A typical agent flow: `mirror_search` → `mirror_info` to
inspect resources → `read_resource` to pull the rows it needs, citing the `sourceUrl` it found.

> The semantic half of `mirror_search` is only as good as the configured embedder — wire a real one
> (see [`semantic-search.md`](./semantic-search.md)); otherwise only the keyword leg is meaningful.

## 2. Directly off disk

The store is a plain, browsable layout — a consumer can read it without any danni code:

```
store/
 ├─ raw/      <dataset_id>/<resource_id>/raw.*            byte-faithful source archive
 ├─ curated/  <dataset_id>/<resource_id>/data.* + schema.json   normalized, UTF-8, declared schema
 └─ danni.sqlite                                          metadata, entities, links, translations, index
```

- **Curated data**: `store/curated/<dataset_id>/<resource_id>/data.ndjson` (tabular, one JSON object
  per line), `data.json` (JSON/GeoJSON), `data.xml`, or `data.txt`, alongside a `schema.json`.
- **Metadata + index**: `store/danni.sqlite` (`datasets`, `resources`, `curated_artifacts`,
  `entities`, `dataset_entities`, `dataset_links`, `translations`, `datasets_fts`, `dataset_embeddings`).

### Contracts

The machine-readable shapes are JSON Schemas under
[`specs/001-egov-data-sync/contracts/`](../specs/001-egov-data-sync/contracts/):

| Schema | Describes |
|---|---|
| `curated-dataset.schema.json` | the `mirror_info` record |
| `index-entry.schema.json` | a `mirror_search` result |
| `curated-tabular-artifact.schema.json` | a tabular curated artifact + its column schema |
| `manifest.schema.json` / `sync-run.schema.json` | per-run provenance |

These are validated in CI against the real output (`tests/contract/`), so a consumer can rely on
them. The `danni mcp` tool outputs reuse these shapes: `mirror_info` → curated-dataset,
`mirror_search` / `mirror_entity_search` → index-entry. `read_resource` returns a `ResourceContent`
shape (`rows` / `document` / `text` + pagination), documented in the tool table above rather than as
a published JSON-Schema contract.

## Freshness

Every record carries a `freshness` block (`lastSyncedAt`, `sourceLastModified`, `isStale`,
`freshnessSloSeconds`) so a consumer can decide how much to trust it. `danni status` reports the
last successful sync and the freshness SLO for the mirror as a whole.
