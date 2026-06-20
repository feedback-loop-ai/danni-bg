# Data Model: Region multi-select + geo-filter roll-up

No new tables or columns. This feature reuses existing state and the existing knowledge graph.

## Selection state (frontend, `explorerStore`)

The map selection is **not** a separate field — it **is** `filters.geoUnitIds: string[]` (geo entity
ids, namespaced `geo:`). `selectRegions(ids)` rewrites only that array. Removing the old
`selectedRegionId: string | null` eliminated a second, drift-prone copy of the selection.

| State | Type | Notes |
|---|---|---|
| `filters.geoUnitIds` | `string[]` | the selected regions = the geo filter; OR-matched downstream |

## Hierarchy source (backend, `part_of` knowledge graph)

The oblast→municipality hierarchy is read from the `entity_relations` table, predicate `part_of`
(`municipality entity id --part_of--> oblast entity id`) — the same edges that power the choropleth
roll-up (spec 013, spec 016). No schema change.

- `ReadBridge.partOfParents(): Map<child, parent>` — existing (municipality → oblast).
- `ReadBridge.partOfChildren(): Map<parent, child[]>` — **new**, the inverse, built from the same rows.

## Derived: expanded geo filter (pure)

`expandGeoUnitIds(geoUnitIds, childrenOf)` (`geo-rollup.ts`) maps the selected/scoped ids to the set
actually matched against datasets:

```
[] → []                                              (no filter)
[oblast]      → [oblast, ...its municipalities]      (roll-up to match the map)
[municipality]→ [municipality]                       (leaf, exact)
[unknown]     → [unknown]                             (pass-through)
```

The result is de-duplicated and consumed by the unchanged matchers (`matchesFiltersLite`,
`scope-filter.matchesFilters`), so the dataset comparison logic is untouched — only the id set grows.
