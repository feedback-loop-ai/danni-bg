# Contract: Regions API (choropleth + drill-down)

**Feature**: 012-map-drilldown · **Service**: `apps/explorer-api` (Bun + Hono)

This feature reuses the explorer HTTP API defined in `specs/008-map-data-explorer/contracts/http-api.md`. It changes exactly two shapes, documented here, both contract-tested and Zod-validated (Constitution III/VII):

1. `RegionSummary` (returned by `GET /api/regions`) gains **`oblastEntityId`** — the parent oblast of a municipality, which drives the client grouping and the oblast→municipality drill-down.
2. The bundled geo-crosswalk entry gains **`lauId`** — the official Eurostat LAU id used to join the 265-municipality gazetteer to real boundary geometry.

Authoritative Bulgarian fields are returned verbatim (Constitution X). Counts reflect the supplied filters but are **selection-independent** — see "Selection independence" below (FR-014/#21).

---

## GET /api/regions

Choropleth aggregates for all administrative units at one level. Drives both the national oblast layer and the drilled-in municipality layer.

**Query**:
| param | type | default | notes |
|-------|------|---------|-------|
| `level` | `oblast \| municipality` | `oblast` | which layer to aggregate; `municipality` returns all 265 municipalities |
| filter params | — | — | same as `/api/datasets` (tags, publisherIds, freshness, query, includeWithdrawn). **The map fetches these with the region selection (`geoUnitIds`) stripped** — see below |

**200**: `{ "regions": RegionSummary[] }`

```json
{
  "regions": [
    {
      "entityId": "geo:bg-municipality-stolichna",
      "level": "municipality",
      "labelBg": "Столична",
      "labelEn": "Stolichna",
      "boundaryFeatureId": "lau-SOF46",
      "datasetCount": 12,
      "hasData": true,
      "maxConfidence": 0.9,
      "oblastEntityId": "geo:bg-oblast-sofia-grad"
    },
    {
      "entityId": "geo:bg-oblast-plovdiv",
      "level": "oblast",
      "labelBg": "Пловдив",
      "labelEn": "Plovdiv",
      "boundaryFeatureId": "BG-16",
      "datasetCount": 134,
      "hasData": true,
      "maxConfidence": 0.95,
      "oblastEntityId": null
    }
  ]
}
```

**`RegionSummary` fields** (see `data-model.md` for the authoritative table):
| field | type | notes |
|-------|------|-------|
| `entityId` | string \| null | `geo:bg-oblast-*` / `geo:bg-municipality-*`; null for an unlinked boundary unit |
| `level` | `oblast \| municipality` | |
| `labelBg` | string | authoritative Cyrillic, verbatim |
| `labelEn` | string \| null | derived label |
| `boundaryFeatureId` | string | join key into the bundled GeoJSON the SVG paints |
| `datasetCount` | integer | de-duplicated in-scope count; for oblasts, the union of direct + municipality-rolled-up links, counted once (FR-016) |
| `hasData` | boolean | false → reserved "no data" colour bucket (still rendered) |
| `maxConfidence` | number | strongest geo-link confidence among contributing datasets |
| **`oblastEntityId`** | string \| null | **new** — parent oblast of a municipality (drives drill-down grouping, FR-013); null for oblast rows |
| `flagged` | `"unlinked"`? | present when a boundary unit has no gazetteer/crosswalk link |

### Selection independence (FR-014 / FR-015 / PR #21)

The choropleth is a **global "datasets per region" view** and MUST NOT shrink when the user selects or drills into a region. The client therefore calls `GET /api/regions` with the region selection removed from the filter (`geoUnitIds: []`), memoized on the non-geo filter fields. Selecting a region scopes only `GET /api/datasets` (the list) and the chat. Consequence: drilling into an oblast shows its municipalities' counts on the first click rather than emptying out and settling after a further interaction.

---

## Bundled geo-crosswalk entry — `lauId` addition

The static crosswalk (`packages/geo-boundaries/data/crosswalk.json`) joins gazetteer entity ids to boundary features by official code. Validated by `crosswalkEntrySchema` (`packages/geo-boundaries/src/schema.ts`). This feature adds `lauId`.

**Entry shape**:
```json
{
  "entityId": "geo:bg-municipality-stolichna",
  "level": "municipality",
  "boundaryFeatureId": "lau-SOF46",
  "ekatte": null,
  "lauId": "SOF46",
  "iso3166_2": null
}
```

| field | type | rule |
|-------|------|------|
| `entityId` | string | `^geo:bg-(oblast\|municipality)-[a-z0-9-]+$`; must exist in the gazetteer |
| `level` | `oblast \| municipality` | |
| `boundaryFeatureId` | string | non-empty; exists in the matching GeoJSON (municipalities keyed `lau-<LAU_ID>`) |
| `ekatte` | string \| null | `^[0-9]{5}$`; null for oblasts |
| **`lauId`** | string \| null | **new** — non-empty official LAU id; null for oblasts |
| `iso3166_2` | string \| null | `^BG-[0-9]{2}$`; null for municipalities |

**Conditional rules** (`superRefine`):
- `level: "oblast"` → `ekatte === null`, `lauId === null`, `iso3166_2` required.
- `level: "municipality"` → `iso3166_2 === null`, and **at least one of** `ekatte` / `lauId` present (the LAU-derived municipalities carry `lauId`).

---

## Parity obligations

`GET /api/regions` is one row in `tests/parity-matrix.json` with its contract test (shared with 008). The extended `oblastEntityId` field and the crosswalk `lauId` field are exercised by:
- `apps/explorer-api/tests/regions-aggregate.test.ts` — asserts `oblastEntityId` and the municipality→oblast roll-up de-duplication.
- `packages/geo-boundaries/tests/schema.test.ts` + `crosswalk.test.ts` — assert the `lauId` validation rules and crosswalk↔gazetteer↔GeoJSON integrity.
- `apps/explorer-web/e2e/us1-map.e2e.ts` — behavioral coverage of the drill-down the `oblastEntityId` field enables.
