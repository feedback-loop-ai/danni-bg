# danni-bg

A synced local mirror of [data.egov.bg](https://data.egov.bg/) (Bulgaria's open-data portal) —
curated, enriched, and indexed — with an **interactive map explorer and a grounded chat assistant**
on top.

`danni-bg` is a Bun + TypeScript monorepo with two layers over one SQLite store:

### Build layer — the `danni` CLI pipeline

```
sync  →  curate  →  enrich  →  index  →  search
```

1. **Sync** — discovers and downloads every dataset from the portal into a byte-faithful layout
   under `store/raw/`. The full crawl is resumable (per-scope checkpoint cursor, `--max` batches,
   `--retry-failed`) and respectful (rate limit, backoff, robots policy).
2. **Curate** — normalizes each captured resource into a UTF-8, declared-schema artifact under
   `store/curated/` (CSV/XLSX/JSON/GeoJSON/XML/text), with provenance.
3. **Enrich** — extracts entities (publishers, geographic units, time periods, tags), links related
   datasets (fan-out-capped so generic tags don't form cliques), and adds machine-translated English
   alongside — never overwriting authoritative Bulgarian fields.
4. **Index** — builds FTS5 + vector indexes for hybrid keyword + semantic retrieval over Cyrillic and
   English, incrementally and at corpus scale.

### Serve layer — read-only, over the same store

- **MCP server** (`danni mcp`) — read-only tools (`mirror_search`, `mirror_info`, `read_resource`, …)
  for LLM agents. See [docs/CONSUMERS.md](docs/CONSUMERS.md).
- **Web explorer** (`apps/explorer-api` + `apps/explorer-web`) — an interactive Bulgaria choropleth
  (dataset density by oblast), filters and facets, dataset drilldown (table / bar & line charts /
  download), and a **grounded chat assistant** that answers from the actual data with validated
  citations. The chat runs a scoped tool loop over real LLMs, with a RAG fallback for providers
  without function-calling.

The store on disk is the source of truth; every stage is re-runnable and every result carries a
`sourceUrl` (back to data.egov.bg) + a curated-artifact path for one-hop traceability.

## Quickstart

- **Mirror the portal**: [`specs/001-egov-data-sync/quickstart.md`](specs/001-egov-data-sync/quickstart.md)
  — the 5-minute clone-to-mirror walkthrough.
- **Run the explorer**: [`specs/008-map-data-explorer/quickstart.md`](specs/008-map-data-explorer/quickstart.md).
- **Wire a real embedder / LLM**: [`docs/semantic-search.md`](docs/semantic-search.md).

## Documentation

| Doc | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full architecture + diagrams (build pipeline **and** the explorer / serving layer) |
| [docs/CONSUMERS.md](docs/CONSUMERS.md) | Reading the mirror: MCP server, direct-off-disk, machine-readable contracts |
| [docs/semantic-search.md](docs/semantic-search.md) | Configuring a real embedder for genuine semantic + cross-lingual recall |
| [specs/008-map-data-explorer/contracts/](specs/008-map-data-explorer/contracts/) | The explorer HTTP API + chat-tool contracts |

## License

See [LICENSE](./LICENSE).
