# Chat answer contract delta

**No API shape change.** No endpoints, request fields, or SSE event shapes are added or modified.

The change is to the **content of the answer prose** only:

- The `token` SSE stream (the answer text) no longer contains dataset ids / UUIDs / `datasetId`
  columns — datasets are named by their Bulgarian title.
- The `citations` SSE event is **unchanged** and remains the source of each cited dataset's
  `datasetId` + `sourceUrl` (what the UI links). Consumers that need ids read them from `citations`,
  not from the prose.

Backward compatible: any client parsing the SSE stream sees the same events; only the human-facing
text is cleaner.
