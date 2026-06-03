# `organization_show`

Full metadata for a single publisher.

## Request

```
GET https://data.egov.bg/api/3/action/organization_show?id=<id-or-slug>
```

## Success response

```json
{
  "help": "<URL>",
  "success": true,
  "result": {
    "id": "<uuid>",
    "name": "<slug>",
    "title": "<bg title>",
    "description": "<bg description>",
    "package_count": 42
  }
}
```

## Contract test

`tests/contract/ckan/organization_show.test.ts` (registered in `tests/parity-matrix.json#endpoints`).
