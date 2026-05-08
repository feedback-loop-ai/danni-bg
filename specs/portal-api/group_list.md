# `group_list`

Enumerate group / category records.

## Request

```
GET https://data.egov.bg/api/3/action/group_list?all_fields=true
```

## Success response

```json
{
  "help": "<URL>",
  "success": true,
  "result": [
    { "id": "<uuid>", "name": "<slug>", "title": "<bg title>", "description": "<bg description>" }
  ]
}
```

## Contract test

`tests/contract/ckan/group_list.test.ts` (registered in `tests/parity-matrix.json#endpoints`).
