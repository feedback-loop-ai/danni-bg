# `package_list`

Enumerate every public dataset identifier on the portal.

## Request

```
GET https://data.egov.bg/api/3/action/package_list
```

No required query parameters. CKAN supports `limit` and `offset`, but we do not rely on them — `package_search` is preferred for paginated discovery (FR-001).

## Success response

```json
{
  "help": "<URL>",
  "success": true,
  "result": ["dataset-slug-1", "dataset-slug-2", "..."]
}
```

`result` is an array of dataset slugs (CKAN `name` field), **not** UUIDs. To resolve to the full record, follow up with `package_show?id=<slug>`.

## Error response

```json
{
  "help": "<URL>",
  "success": false,
  "error": { "__type": "Authorization Error", "message": "..." }
}
```

## Contract test

`tests/contract/ckan/package_list.test.ts` (registered in `tests/parity-matrix.json#endpoints`).
