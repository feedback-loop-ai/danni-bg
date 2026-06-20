# Requirements checklist

Retrospective verification for spec 023 (all items met on `main`).

## Functional

- [x] FR-094 — Shift+click multi-selects regions (oblasts in country view, municipalities in
  drill-down); list + chat filter on the union. *(headless: 2 oblasts → 2 `geoUnitIds`; drill → 2
  municipalities)*
- [x] FR-095 — Plain click keeps drill / single-select; selection is `filters.geoUnitIds` (single
  source of truth), chips + highlight consistent.
- [x] FR-096 — Municipality refinement drops the parent oblast id. *(headless drill union carried no
  oblast id)*
- [x] FR-097 — Oblast geo filter expands to its municipalities; leaf/unknown pass through.
  *(unit-tested; live 638 / 33)*
- [x] FR-098 — Expansion applied across list / facets / national / regions / keyword-search.
- [x] FR-099 — Chat geo-scope expanded identically (hard filter + fallback). *(live: oblast scope
  grounds on Казанлък municipality datasets)*

## Success criteria

- [x] SC-001 — Oblast list total = choropleth count (Стара Загора 638).
- [x] SC-002 — Municipality total exact (Казанлък 33).
- [x] SC-003 — Multi-select issues both `geoUnitIds`; drill union excludes the oblast.
- [x] SC-004 — Oblast chat-scope grounds on a municipality's datasets (28 citations).

## Quality gates

- [x] Pure logic unit-tested (`geo-rollup.test.ts`, `explorerStore.test.ts`).
- [x] No new tables/columns; reuses `entity_relations` `part_of`.
- [x] 181 explorer-api `bun:test` + web unit tests + tsc + biome green; CI green on PRs #66/#67.
- [x] Backward-compatible API (semantic-only change to `geoUnitIds`).

## Known limitation

- [ ] Tool-loop retrieval recall under a tight geo-scope is unchanged (global-rank-then-filter) —
  tracked as a follow-up; this feature fixes filter semantics, not ranking.
