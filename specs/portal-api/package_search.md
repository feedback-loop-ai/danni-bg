# `package_search`

Filtered + paginated discovery over the dataset corpus.

## Request

```
GET https://data.egov.bg/api/3/action/package_search?q=<solr>&start=<int>&rows=<int>&sort=<solr-sort>&fq=<solr-fq>
```

| Param | Type | Notes |
|---|---|---|
| `q` | string | Solr query string. `*:*` matches all. |
| `start` | int | 0-based offset for pagination. |
| `rows` | int | Page size; the portal caps at 1000. We default to 100. |
| `sort` | string | E.g. `metadata_modified desc` for incremental discovery (FR-004). |
| `fq` | string | Solr filter query, e.g. `organization:<slug>` for scope filter. |

## Success response

```json
{
  "help": "<URL>",
  "success": true,
  "result": {
    "count": 1234,
    "results": [ /* full Package records, see package_show.md */ ],
    "facets": { ... },
    "search_facets": { ... }
  }
}
```

`count` is the total matching across all pages; `results` is the current page.

## Error response

Same envelope as `package_list`.

## Contract test

`tests/contract/ckan/package_search.test.ts` (registered in `tests/parity-matrix.json#endpoints`).
