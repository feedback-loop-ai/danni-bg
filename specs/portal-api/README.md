# data.egov.bg Portal API Reference

This directory is the authoritative reference for every data.egov.bg endpoint the `danni-bg` crawler depends on. Constitution III requires that every consumed endpoint have its request shape, response shape, error envelope, and pagination semantics documented here, and a corresponding contract test recorded in `tests/parity-matrix.json#endpoints`.

## Base

The portal exposes a CKAN-compatible Action API at:

```
https://data.egov.bg/api/3/action/
```

All endpoints accept an HTTP `GET` request. Successful responses are JSON envelopes shaped as:

```json
{
  "help": "<documentation URL>",
  "success": true,
  "result": <endpoint-specific>
}
```

Errors are returned with a non-`success` flag and an `error` envelope:

```json
{
  "help": "<documentation URL>",
  "success": false,
  "error": {
    "__type": "<CKAN exception class>",
    "message": "<human-readable>"
  }
}
```

HTTP status: `200` is used even for `success=false` envelopes for some CKAN deployments; clients MUST inspect the `success` boolean. Transport-level errors (5xx, network) are handled by the retry/backoff layer (`src/crawler/backoff.ts`).

## Endpoints consumed

| Endpoint file | Purpose | Spec ref |
|---|---|---|
| [`package_list.md`](./package_list.md) | Enumerate all dataset identifiers | FR-001 |
| [`package_search.md`](./package_search.md) | Filtered + paginated discovery | FR-001, FR-018 |
| [`package_show.md`](./package_show.md) | Full dataset metadata + resource list | FR-002 |
| [`organization_list.md`](./organization_list.md) | Enumerate publishers | FR-019a |
| [`organization_show.md`](./organization_show.md) | Authoritative publisher metadata | FR-019a |
| [`group_list.md`](./group_list.md) | Enumerate categories/groups | FR-018 |
| [`group_show.md`](./group_show.md) | Full group metadata | FR-018 |
| [`tag_list.md`](./tag_list.md) | Enumerate tags | FR-018 |
| [`resource_get.md`](./resource_get.md) | Off-portal resource HTTP GET | FR-002, FR-005 |

A live smoke run (T125, deferred to operator) records the observed dataset/resource counts and any divergence from this spec into [`scale.md`](./scale.md).

## Conditional requests

The crawler issues conditional requests on every resource fetch (R7): `If-None-Match` when a stored `etag` is known, else `If-Modified-Since` when a stored `last_modified` is known, else an unconditional `GET` with on-the-fly content-hash comparison. Upstream support for either header is best-effort; the content-hash fallback satisfies FR-004 in all cases.
