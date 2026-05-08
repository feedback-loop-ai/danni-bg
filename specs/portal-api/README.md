# data.egov.bg API Reference Spec

This directory holds the **authoritative reference** for every endpoint on
`data.egov.bg` that the danni-bg crawler depends on. It satisfies
Constitution Principle III (Contract-First API Design) and is the source of
truth for the contract tests required by Principle VIII.

## Status

**Bootstrapped on 2026-05-08** as part of feature `001-egov-data-sync` (Phase
1 design). At this point the directory contains only this README + the list
of expected endpoints. Concrete fixtures and per-endpoint schemas will be
captured as the first live smoke run records them (Phase 2 task in
`tasks.md`).

## Expected endpoints (from research.md R1)

| Endpoint | Purpose | Spec FR |
|---|---|---|
| `GET /api/3/action/package_list` | Enumerate dataset IDs | FR-001 |
| `GET /api/3/action/package_search?rows=&start=&fq=` | Paginated, filterable enumeration | FR-001, FR-018 |
| `GET /api/3/action/package_show?id=<id>` | Full dataset metadata + resources | FR-002 |
| `GET /api/3/action/organization_list` | Organization enumeration | FR-019a |
| `GET /api/3/action/organization_show?id=<id>` | Organization detail | FR-019a |
| `GET /api/3/action/group_list` | Category enumeration | FR-018 |
| `GET /api/3/action/group_show?id=<id>` | Category detail | FR-018 |
| `GET /api/3/action/tag_list` | Tag enumeration | FR-018 |
| `GET <resource.url>` | Resource bytes (off-portal allowed) | FR-002, FR-005 |
| `GET /robots.txt` | Crawler etiquette | Principle XI |

## Per-endpoint file structure (to be filled in)

Each endpoint will have:

```
specs/portal-api/<endpoint-name>/
├── request.schema.json    # Path, query, headers
├── response.success.schema.json
├── response.error.schema.json
├── pagination.md          # If applicable
├── fixtures/              # Recorded live responses for tests
│   └── <case-name>.json
└── notes.md               # Any deviation from vanilla CKAN observed
```

## Parity matrix

`tests/parity-matrix.json` (Constitution VIII) maps each endpoint above to its
contract test. CI fails if an endpoint is consumed by `src/crawler/` but has
no entry in the matrix.

## Scale snapshot

`scale.md` (created by the first live smoke task) records the observed total
dataset count, resource count, total raw bytes, and median response size as
of the most recent successful smoke run. It informs operator capacity
planning (research.md R8).
