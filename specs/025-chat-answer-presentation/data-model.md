# Data Model: Chat answer presentation

No schema, table, or state change. This feature is a single prompt-constant edit.

| Item | Where | Change |
|---|---|---|
| `SYSTEM_PROMPT` | `apps/explorer-api/src/chat/grounding.ts` | + clause: reference datasets by Bulgarian title; never print ids/UUIDs/technical identifiers in the answer (ids are for tool calls only) |

The `citations` SSE event (and its `Citation` shape: `datasetId`, `titleBg`, `sourceUrl`, `freshness`)
is unchanged — it remains the out-of-band carrier of each cited dataset's id + link for the UI.
