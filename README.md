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
   `store/curated/` (CSV/XLSX/JSON/GeoJSON/XML/text), with provenance. `danni curate --entities-only`
   re-extracts entities without re-parsing or re-translating resources.
3. **Enrich** — extracts entities (publishers, geographic units, time periods, tags), links related
   datasets (fan-out-capped so generic tags don't form cliques), and adds machine-translated English
   alongside — never overwriting authoritative Bulgarian fields. It also infers a dataset's
   administrative place from its **publisher org name** when its own metadata names none (shrinking
   the national / non-georeferenced bucket from ~57% to ~15% of the mirror), and materializes a typed
   **entity knowledge graph** (`entity_relations`, predicate `part_of` = municipality→oblast)
   queryable via **`GET /api/entities/:id`**.
4. **Index** — builds FTS5 + vector indexes for hybrid keyword + semantic retrieval over Cyrillic and
   English, incrementally and at corpus scale.

### Serve layer — read-only, over the same store

- **MCP server** (`danni mcp`) — read-only tools (`mirror_search`, `mirror_info`, `read_resource`, …)
  for LLM agents. See [docs/CONSUMERS.md](docs/CONSUMERS.md).
- **Web explorer** (`apps/explorer-api` + `apps/explorer-web`) — an **SVG choropleth with
  oblast→municipality drill-down** (real 265-municipality geometry from Eurostat GISCO LAU 2021),
  where an oblast's count is the de-duplicated roll-up of its own datasets plus its municipalities',
  a **faceted search panel** (tag + publisher facets with result counts, backed by `/api/facets`),
  and a dataset drilldown built around a **centre document reader plus a tabular grid** (server-side
  sort + per-column filters over the whole resource). On top sits a **grounded chat assistant**:
  grounded by construction — the focused / open dataset's real rows are injected as ground-truth
  context, kept sticky across follow-ups, and hardened against fabrication.
- **Authenticated chat platform** (specs 019–022) — public browsing stays open; **chat + admin are
  gated** behind an Ory identity stack (email+password **or passkeys**, link-mode recovery). Tiered
  users (admin/user); an admin **platform-settings** page configures the LLM endpoint + quota policy at
  runtime. **Per-user token metering with enforced quotas** (cache-discounted), an **account page**
  (appearance, profile, password, passkeys, usage, avatar), and **persistent, resumable chat
  sessions** — conversations survive reloads and a turn keeps streaming across a disconnect (re-attach).

The store on disk is the source of truth; every stage is re-runnable and every result carries a
`sourceUrl` (back to data.egov.bg) + a curated-artifact path for one-hop traceability.

## Quickstart

- **Mirror the portal**: [`specs/001-egov-data-sync/quickstart.md`](specs/001-egov-data-sync/quickstart.md)
  — the 5-minute clone-to-mirror walkthrough.
- **Run the explorer**: [`specs/008-map-data-explorer/quickstart.md`](specs/008-map-data-explorer/quickstart.md).
- **Run the identity stack** (Kratos + Mailpit; for gated chat / accounts): [`infra/ory/README.md`](infra/ory/README.md).
- **Wire a real embedder / LLM**: [`docs/semantic-search.md`](docs/semantic-search.md).

## Documentation

| Doc | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full architecture + diagrams (build pipeline **and** the explorer / serving layer) |
| [docs/CONSUMERS.md](docs/CONSUMERS.md) | Reading the mirror: MCP server, direct-off-disk, machine-readable contracts |
| [docs/semantic-search.md](docs/semantic-search.md) | Configuring a real embedder for genuine semantic + cross-lingual recall |
| [specs/008-map-data-explorer/contracts/](specs/008-map-data-explorer/contracts/) | The explorer HTTP API + chat-tool contracts |
| [infra/ory/README.md](infra/ory/README.md) | The Ory identity stack (Kratos + Mailpit), single-port mode, passkeys |
| [specs/019-022-*/](specs/) | Identity + admin settings + passkeys (019), persistent/resumable chat (020), token metering (021), account & chat-UX (022) |

## License

See [LICENSE](./LICENSE).
