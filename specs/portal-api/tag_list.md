# `tag_list`

Enumerate tags.

## Request

```
GET https://data.egov.bg/api/3/action/tag_list?all_fields=true
```

## Success response

```json
{
  "help": "<URL>",
  "success": true,
  "result": [
    { "id": "<uuid>", "name": "<tag>", "display_name": "<tag>" }
  ]
}
```

## Contract test

`tests/contract/ckan/tag_list.test.ts` (registered in `tests/parity-matrix.json#endpoints`).
