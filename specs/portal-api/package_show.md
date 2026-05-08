# `package_show`

Full metadata for a single dataset, including its resources.

## Request

```
GET https://data.egov.bg/api/3/action/package_show?id=<id-or-slug>
```

`id` may be either the CKAN UUID or the slug.

## Success response

```json
{
  "help": "<URL>",
  "success": true,
  "result": {
    "id": "<uuid>",
    "name": "<slug>",
    "title": "<bg title>",
    "notes": "<bg description, may be empty>",
    "metadata_created": "2024-01-01T00:00:00.000000",
    "metadata_modified": "2025-12-01T00:00:00.000000",
    "license_id": "cc-by-4.0",
    "organization": {
      "id": "<org uuid>",
      "name": "<org slug>",
      "title": "<org title>",
      "description": "<org description>"
    },
    "tags": [ { "name": "<tag>", "display_name": "<tag>" } ],
    "groups": [ { "name": "<group slug>", "title": "<group title>", "id": "<group uuid>" } ],
    "resources": [
      {
        "id": "<resource uuid>",
        "name": "<label>",
        "description": "<bg description>",
        "url": "<url>",
        "format": "CSV",
        "mimetype": "text/csv",
        "position": 0,
        "size": 12345,
        "created": "2024-01-01T00:00:00.000000",
        "last_modified": "2025-12-01T00:00:00.000000"
      }
    ]
  }
}
```

## Error response

If the dataset id is unknown:

```json
{ "success": false, "error": { "__type": "Not Found Error", "message": "..." } }
```

Two consecutive 404s collapse to a `withdrawn` lifecycle event (FR-016).

## Contract test

`tests/contract/ckan/package_show.test.ts` (registered in `tests/parity-matrix.json#endpoints`).
