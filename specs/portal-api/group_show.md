# `group_show`

Full metadata for a single group / category.

## Request

```
GET https://data.egov.bg/api/3/action/group_show?id=<id-or-slug>
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

`tests/contract/ckan/group_show.test.ts` (registered in `tests/parity-matrix.json#endpoints`).
