# egov fixtures (004-crawl-checkpoint-resume)

Recorded responses for data.egov.bg's custom POST API, replayed through `EgovBgClient` so the
test loop never hits the live network (Constitution VI). Each file is the raw `{success, ...}`
envelope returned by one method.

| file | method | notes |
|---|---|---|
| `listDatasets.json` | `listDatasets` | a `total_records` + `datasets[]` page (3 datasets). |
| `getDatasetDetails.json` | `getDatasetDetails` | a single dataset's `data` with `updated_at` + `version` (drives the validator). |
| `listResources.json` | `listResources` | the resources for the dataset (3 resources). |
| `getResourceData.json` | `getResourceData` | tabular datastore (array-of-arrays, header first). |
| `listOrganisations.json` | `listOrganisations` | publisher resolution page. |
| `getOrganisationDetails.json`, `getResourceMetadata.json` | (reference) | recorded for completeness. |

## Recording procedure

These were captured from the live portal with `curl` against `https://data.egov.bg/api/<method>`
(public read endpoints, no api_key needed), e.g.:

```bash
curl -s -X POST https://data.egov.bg/api/listDatasets \
  -H 'content-type: application/json' \
  -d '{"records_per_page":3,"page_number":1}' | jq . > listDatasets.json
```

Cyrillic is preserved byte-exact (Constitution X) — do not re-encode.

## Resume / multi-session test fixtures

The interrupt/resume, bounded-session, and edge-case integration tests
(`tests/integration/egov-*.test.ts`) build their own in-memory multi-dataset fake `EgovBgClient`
via `tests/integration/egov-fixtures.ts` rather than committing one JSON file per synthetic
dataset. That helper:

- serves a configurable multi-page `listDatasets` set (≥2 pages so cursor advance is exercised),
- serves per-dataset `getDatasetDetails` with mutable `updated_at`/`version` so a single dataset's
  validator can be bumped between sessions (the content-changed re-fetch case, T215),
- serves per-dataset `listResources` (multiple resources each),
- serves both tabular (array-of-arrays) and structured (single JSON object) `getResourceData`,
- counts every `getResourceData`/`getDatasetDetails`/`listDatasets` call so a test can assert
  "no fetch on resume" (SC-001) and "no discovery once completed" (SC-005).
