# Phase 1 Data Model: Interactive Bulgarian Map Data Explorer

**Feature**: 008-map-data-explorer
**Date**: 2026-06-05

The explorer introduces **no new persisted entities**. It composes view models over the existing curated mirror (read via `src/read` + `src/index/query.ts`) plus bundled boundary data, and holds two ephemeral, in-memory structures (conversation session, client-side provider config). All authoritative Bulgarian fields are passed through verbatim (Constitution X); every dataset/resource view carries the mirror's freshness block (Constitution IX).

## Source entities (existing — reused, not redefined)

These already exist in the mirror and are consumed read-only. Shapes summarized for reference only.

- **Dataset** — `datasetId`, bilingual `title`/`description` (+ `translator`, `translationConfidence`), `publisher`, `tags`, `lifecycleState`, `freshness {lastSyncedAt, sourceLastModified, sourceEtagOrHash, isStale, freshnessSloSeconds}`, `resources[]`, `entities[]`, `links[]`, `sourceUrl`.
- **Resource** — `resourceId`, `name`, `kind` (tabular/document/text), `schema` (columns/types/encoding/rowCount), `curatedPath`, per-resource `freshness`.
- **Entity** — `entityId` (e.g. `geo:bg-oblast-sofia`, `org:egov-org-61`, `tag:въздух`), `kind` (geographic_unit | organization | tag | time_period | …), bilingual `label`, `extractor`, `confidence`.
- **Link** — `otherDatasetId`, `viaEntityId`, `heuristic`, `confidence`.

## New view models (derived, not stored)

### RegionSummary
Per administrative unit aggregate that drives the choropleth.

| Field | Type | Notes |
|-------|------|-------|
| `entityId` | string | `geo:bg-oblast-*` or `geo:bg-municipality-*` |
| `level` | `"oblast" \| "municipality"` | drives zoom-level styling |
| `labelBg` | string | authoritative Bulgarian name (verbatim) |
| `labelEn` | string \| null | derived/English label, may be null |
| `boundaryFeatureId` | string | join key into bundled GeoJSON (via crosswalk) |
| `datasetCount` | integer | de-duplicated count of in-scope datasets linked to this unit |
| `hasData` | boolean | false → rendered as "no datasets" (FR-004 empty state) |
| `maxConfidence` | number | highest geo-link confidence among its datasets (flag low-confidence placements) |

**Rules**: counts are de-duplicated across multi-region datasets (Edge Case). `datasetCount`/`hasData` always reflect the **current FilterState** (FR-014). Units present in boundary data but absent from the gazetteer/crosswalk get `entityId=null`, `hasData=false`, and are flagged "not linked" (R5 gap).

### DatasetPointer
List-row projection for region panels, filter results, and chat citations.

| Field | Type | Notes |
|-------|------|-------|
| `datasetId` | string | |
| `titleBg` / `titleEn` | string / string\|null | authoritative + derived |
| `translationConfidence` | number \| null | UI labels machine-translated text (FR-031) |
| `publisher` | `{id, titleBg}` | |
| `tags` | string[] | |
| `freshness` | FreshnessBlock | surfaced on every row (Constitution IX) |
| `geoEntityIds` | string[] | regions this dataset highlights on the map |
| `sourceUrl` | string | one-hop traceability (SC-002) |
| `score` | number \| null | present for ranked search results |

### DatasetDetailView
Full detail surface (FR-005) — a thin reshape of `datasetView()` output: description, resources (with schema + freshness), `entities`, `links` (related datasets), `lifecycleState`, `sourceUrl`. No new fields; withdrawn datasets carry their lifecycle state (hidden by default per Assumptions).

### FilterState
The single shared state object (frontend store + sent to chat as scope).

| Field | Type | Notes |
|-------|------|-------|
| `tags` | string[] | tag entity ids/labels; AND across filter types, OR within a multi-select is a UI detail |
| `publisherIds` | string[] | `org:egov-org-*` |
| `geoUnitIds` | string[] | `geo:bg-*`; synced with map selection (FR-009) |
| `freshness` | `"fresh" \| "stale" \| "any"` | maps to `isStale`/SLO (FR-010) |
| `query` | string | free-text, BG or EN (FR-011) |
| `includeWithdrawn` | boolean | default false (Assumptions) |

**Validation**: all fields optional/defaulted; empty FilterState = unfiltered national view. Encoded into a deterministic **ScopeDescriptor** for the backend (see chat-tools contract).

### Facets
Available filter options with in-scope counts: `tags[]`, `publishers[]`, `freshnessBuckets[]`, each `{id, labelBg, labelEn?, count}`. Recomputed against current FilterState so users see only productive narrowing.

## Boundary / crosswalk entities (bundled, static)

### BoundaryFeature (GeoJSON)
Standard GeoJSON `Feature` with geometry + `properties.boundaryFeatureId`, `properties.level`, `properties.ekatte?`, `properties.iso3166_2?`. Two collections: `oblasts.geojson`, `municipalities.geojson`.

### GeoCrosswalkEntry
Static join table (validated by `contracts/geo-crosswalk.schema.json`).

| Field | Type | Notes |
|-------|------|-------|
| `entityId` | string | `geo:bg-oblast-*` / `geo:bg-municipality-*` (matches gazetteer) |
| `level` | `"oblast" \| "municipality"` | |
| `boundaryFeatureId` | string | FK into the GeoJSON collection |
| `ekatte` | string \| null | official municipality code (null for oblasts) |
| `iso3166_2` | string \| null | province code (e.g. `BG-18`); null for municipalities |
| `oblastEntityId` | string \| null | parent oblast for a municipality |

**Rules**: `entityId` must exist in `src/enrich/gazetteer/bg-admin.ts`; `boundaryFeatureId` must exist in the bundled GeoJSON. CI test asserts both directions (no orphan crosswalk rows, every gazetteer unit either mapped or explicitly listed as a known gap).

## Ephemeral runtime entities (in-memory only)

### Conversation (server, session-scoped)
| Field | Type | Notes |
|-------|------|-------|
| `sessionId` | string | ephemeral; not persisted (FR-019) |
| `messages` | `{role, content, citations?, anchors?}[]` | retained for session lifetime only |
| `scope` | ScopeDescriptor | filter scope captured per request (FR-025) |

Discarded on session end/timeout; never written to the mirror or any store.

### ProviderConfig (client-side only)
| Field | Type | Notes |
|-------|------|-------|
| `providerKind` | `"openai-compatible" \| "anthropic"` | (FR-021) |
| `baseUrl` | string \| null | for OpenAI-compatible/self-hosted endpoints |
| `model` | string | |
| `apiKey` | string \| null | stored in browser `localStorage`; sent per request over TLS; **never persisted/logged server-side** (FR-024) |
| `useServerDefault` | boolean | when true, backend uses its server-configured default provider |

### Citation & MapAnchor (chat response payload)
- **Citation**: `{datasetId, titleBg, sourceUrl, freshness}` — backend-validated that `datasetId` exists in the mirror (drops/flag uncited or non-existent — SC-005).
- **MapAnchor**: `{geoEntityIds[], datasetIds[]}` — instructs the frontend to highlight/focus regions and datasets (FR-026/FR-027).

## State transitions

- **FilterState change** → recompute RegionSummary counts + Facets + result list; broadcast new ScopeDescriptor to chat (FR-028). Rapid changes are last-write-wins with request cancellation (FR-032).
- **Map selection** ⇄ `geoUnitIds` in FilterState stay mutually consistent (FR-009/FR-014).
- **Chat answer received** → render citations; apply MapAnchor to highlight/focus map (FR-026).
- **Dataset lifecycle = withdrawn** → excluded unless `includeWithdrawn` (Assumptions); never silently shown as current (Constitution IX).

## Constitution alignment notes

- **Freshness (IX)**: `FreshnessBlock` is mandatory on `DatasetPointer`, `DatasetDetailView` resources, and chat `Citation`. No view omits it.
- **Locale (X)**: `*Bg` fields are verbatim authoritative values; `*En`/translated fields are separate and carry `translationConfidence` for UI labelling. Geo joins use `ekatte`/`iso3166_2`, never names.
- **Read-only (I)**: every view model is a projection of `src/read` output; no write path exists in this feature.
