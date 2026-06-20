# HTTP API delta: geo-filter roll-up

No new endpoints or request/response shapes. The change is **semantic**: how existing `geoUnitIds`
parameters are interpreted server-side.

## Affected (explorer)

`geoUnitIds` is a repeatable query param on the catalog endpoints:

- `GET /api/datasets?geoUnitIds=<id>[&geoUnitIds=…][&q=…]`
- `GET /api/facets?geoUnitIds=…`
- `GET /api/national?geoUnitIds=…`
- `GET /api/regions?…` (selection-independent in the UI; expansion is a no-op when empty)

**Before**: a dataset matched if its geo links contained any of the given ids (flat).
**After**: each **oblast** id additionally matches datasets in its **child municipalities** (inverse
`part_of`); municipality/unknown ids are unchanged. The union is still OR-matched.

Observable effect (live):

```
GET /api/datasets?geoUnitIds=geo:bg-oblast-stara-zagora&limit=1   → total 638  (was 128)
GET /api/datasets?geoUnitIds=geo:bg-municipality-kazanlak&limit=1 → total 33   (unchanged)
```

## Affected (chat)

`POST /api/chat` body `scope.geoUnitIds` — the chat's hard scope filter and region-datasets fallback —
is expanded the same way before the turn runs. No shape change; an oblast scope now admits its
municipalities' datasets.

## Compatibility

Backward compatible: callers send the same params; results for oblast filters grow to match the
choropleth roll-up, municipality/other filters are byte-identical.
