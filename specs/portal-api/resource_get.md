# `resource_get` (off-portal HTTP GET)

The byte-faithful capture of a Resource (`FR-002`, `FR-005`). The resource URL is read from `package_show.result.resources[].url` and may live on the portal's host or on a third-party agency host.

## Request

```
GET <resource.url>
User-Agent: danni-bg/<version> (+<contact>)
If-None-Match: <stored etag>      ; if known
If-Modified-Since: <stored last_modified>  ; if known and no etag
```

## Possible responses

- `200 OK` — body is the new bytes; we stream-and-hash.
- `304 Not Modified` — content unchanged; bump `last_synced_at` and emit `skipped_unchanged`.
- `301/302/303/307/308` — followed by the HTTP client; intermediate URLs are not persisted.
- `4xx`/`5xx` — failure; per-resource budget tracked by `src/crawler/backoff.ts`.

## Contract test

`tests/contract/ckan/resource_get.test.ts` (registered in `tests/parity-matrix.json#endpoints`).
