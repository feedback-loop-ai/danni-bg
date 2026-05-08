# `organization_list`

Enumerate publisher organizations.

## Request

```
GET https://data.egov.bg/api/3/action/organization_list?all_fields=true
```

`all_fields=true` returns the full record per organization; without it the response is a list of slugs.

## Success response (with `all_fields=true`)

```json
{
  "help": "<URL>",
  "success": true,
  "result": [
    {
      "id": "<uuid>",
      "name": "<slug>",
      "title": "<bg title>",
      "description": "<bg description>",
      "package_count": 42
    }
  ]
}
```

## Contract test

`tests/contract/ckan/organization_list.test.ts` (registered in `tests/parity-matrix.json#endpoints`).
