# data.egov.bg LIVE API (governmentbg/data-gov-bg)

> The other files in this directory document a **CKAN Action API** contract. The
> live data.egov.bg portal does **not** serve that contract: every CKAN method
> (`package_list`, `package_search`, …) returns `HTTP 404 {"success":false,
> "error":{"type":"Непознат метод"}}` ("Unknown method"), and `/api/3/action/`
> 301-redirects to an internal host. This file documents the portal's **actual**
> API, used by the `egov-bg` adapter (`portal.api: "egov-bg"`). Verified live,
> June 2026, against 11,856 datasets.

## Base + transport

- Base: `https://data.egov.bg/api/`
- Every method is a **POST** to `<base>/<method>` with a JSON body.
- Envelope: `{ "success": true, ... }` or `{ "success": false, "errors": {...}, "error": {"type": "...","message": ...} }` (HTTP 200 even for `success:false` in some cases; clients must inspect `success`).
- **Read methods are public** (no `api_key`). The `api_key`-gated group is for mutations (`addDataset`, `addOrganisation`, …). `apiKeyEnv` in config supplies a key when present.
- Source of truth: `routes/api.php` + `app/Http/Controllers/Api/*` in https://github.com/governmentbg/data-gov-bg.

## robots.txt

`https://data.egov.bg/robots.txt` is `User-agent: * / Disallow: /`. danni is a
robots-respecting crawler, so a live crawl requires `crawler.robots.obey: false`
or `crawler.robots.allowHosts: ["data.egov.bg"]` (operator opt-out, for the
official public API which is intended for programmatic access).

## Methods consumed by the adapter

| Method | Request body | Response (relevant fields) |
|---|---|---|
| `listDatasets` | `{records_per_page, page_number, criteria?}` | `{success, total_records, datasets:[{id, uri, org_id, name, descript}]}` |
| `getDatasetDetails` | `{dataset_uri, locale}` | `{success, data:{uri, name, descript, org_id, category_id, tags:[{name}], organisation?, ...}}` |
| `listResources` | `{criteria:{dataset_uri}, records_per_page?, page_number?}` | `{success, resources:[{uri, name, description, file_format, resource_url, http_rq_type, ...}]}` |
| `getResourceData` | `{resource_uri, version?}` | `{success, data:[[header…],[row…], …]}` (datastore rows; first row is the header) |
| `listOrganisations` | `{criteria, records_per_page, page_number}` | `{success, total_records, organisations:[{id, uri, name, description}]}` |

### Quirks observed live (handled by the schema/adapter)

- `descript` is a **number** (`0`) when a dataset has no description (not a string).
- Resource `type` is a **string** code (not numeric).
- The datastore returns the resource as an **array-of-arrays** with a header row;
  some resources return array-of-objects. The adapter serializes array-of-arrays
  to CSV (so the tabular curator runs) and array-of-objects to JSON.
- The first datastore header cell can carry a UTF-8 BOM (`﻿`); the encoding
  detector strips it during curation.

## How the adapter maps it

`src/crawler/egov-sync.ts` discovers datasets (explicit `scope.datasetIds` URIs,
or paginated `listDatasets` capped by `--max`), resolves each publisher via
`listOrganisations`, persists `datasets`/`resources`/`organizations`, and captures
each resource's datastore content into `store/raw/<dataset_uri>/<resource_uri>/`.
The existing `curate → enrich → index → search` pipeline then runs unchanged.

```
# live scoped pull of one dataset, then curate
danni sync --scope '{"datasetIds":["<uri>"]}'   # portal.api=egov-bg, robots.obey=false
danni curate
danni mirror-info <uri> --json
```
