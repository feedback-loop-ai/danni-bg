# danni-bg

A synced local mirror of [data.egov.bg](https://data.egov.bg/) (Bulgaria's open data portal) with curation, cross-dataset linking, BG↔EN translation, and a machine-readable retrieval index.

`danni-bg` is a single-machine pipeline that:

1. **Discovers and downloads** every dataset from the portal into a byte-faithful local layout under `store/raw/`.
2. **Curates** each captured resource into a UTF-8, declared-schema artifact under `store/curated/`, with provenance.
3. **Enriches** datasets with extracted entities (publishers, geographic units, time periods), cross-dataset links, and machine-translated English titles/descriptions — without ever overwriting authoritative Bulgarian fields.
4. **Indexes** the curated mirror with FTS5 + `sqlite-vec` for keyword + semantic retrieval over Cyrillic and English content.

The MCP read interface is a deliberate follow-up feature; v1 emits machine-readable contracts (manifest, curated dataset, index entry) usable by downstream consumers directly.

## Quickstart

See [`specs/001-egov-data-sync/quickstart.md`](specs/001-egov-data-sync/quickstart.md) for the 5-minute clone-to-mirror walkthrough.

## License

See [LICENSE](./LICENSE).
