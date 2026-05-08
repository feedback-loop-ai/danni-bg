# CLI Contract — `danni-bg`

The CLI is the primary operator interface for v1. Every command's flags are
Zod-validated at startup; misconfiguration fails fast (Principle VII). The
binary is invoked via `bun run` from the repo root or as `danni` once
installed.

> **Exit codes** (stable across releases):
> - `0` — success
> - `2` — usage error (bad flag, bad config)
> - `3` — partial success (some per-resource failures within budget)
> - `4` — outright failure (e.g. portal unreachable, lock contention with
>   `onOverlap=skip`, schema violation in upstream that exceeds budget)
> - `5` — concurrent run rejected (FR-017c)

---

## `danni sync`

Trigger a Sync Run.

```text
danni sync [--scope <json|@file>] [--once] [--manifest-out <path>] [--dry-run]
```

| Flag | Type | Notes |
|---|---|---|
| `--scope` | JSON or `@file` path | Overrides the default scope filter from config. JSON shape per `manifest.schema.json#/$defs/ScopeFilter`. |
| `--once` | boolean | Equivalent to `--trigger=manual`. Default. |
| `--manifest-out` | path | Override output location for the manifest file (default: `<store.root>/manifest/<run_id>.json`). |
| `--dry-run` | boolean | Discover only; do not download. Writes a manifest with all entries marked `discovered` and no captures. |

**Behavior**:
- Acquires the SQLite advisory lock (FR-017c). On contention with
  `onOverlap=skip`, exits with code `5` and writes a `notes` line on the most
  recent `running` run.
- Streams structured JSON logs to stderr per Principle IV.
- On per-resource failures, continues; emits exit code `3` if any failure
  occurred, `0` if none.

---

## `danni curate`

Re-curate the existing local mirror without re-fetching from the portal
(FR-011).

```text
danni curate [--datasets <id,id,...>] [--since <iso8601>] [--curator-version <id>]
```

| Flag | Type | Notes |
|---|---|---|
| `--datasets` | comma-list | Restrict to specific dataset IDs. Default: all active datasets. |
| `--since` | ISO-8601 | Only re-curate datasets touched since this time. |
| `--curator-version` | string | Re-run with a specific curator version (idempotent if already done). |

---

## `danni index`

Rebuild or incrementally update the FTS5 + vector index (FR-015).

```text
danni index [--full] [--datasets <id,id,...>]
```

| Flag | Type | Notes |
|---|---|---|
| `--full` | boolean | Drop and rebuild both FTS and vector tables. Use only when changing embedder model. |
| `--datasets` | comma-list | Update specific dataset IDs only. |

---

## `danni status`

Print health and recent run history (Principle IV; FR-017a).

```text
danni status [--limit <n>] [--json]
```

| Flag | Type | Notes |
|---|---|---|
| `--limit` | integer (1–100) | Number of recent runs to show. Default: 10. |
| `--json` | boolean | Emit `sync-run.schema.json`-conforming records on stdout. |

Without `--json`, prints a human-readable summary including:
- Last successful sync timestamp
- Per-component health (DB writable, store dir writable, robots cache age)
- Embedder + translator provider identity
- Whether a Sync Run is currently in progress and which run holds the lock

---

## `danni schedule`

Manage the scheduler.

```text
danni schedule install   # Validate config and start the in-process scheduler in foreground
danni schedule disable   # Set schedule.enabled=false in config (operator-driven only)
danni schedule show      # Print current schedule + next-run time
```

The scheduler does not daemonize itself; operators run it under their process
manager of choice (systemd, launchd, Docker). When invoked, it acquires no
lock at startup; locks are taken per-run.

---

## `danni search`

(Debug aid) Run a query against the index from the CLI.

```text
danni search "<query>" [--lang bg|en] [--limit <n>] [--json]
```

| Flag | Type | Notes |
|---|---|---|
| `--lang` | enum | Hint to the query planner. Default: auto-detect. |
| `--limit` | integer (1–50) | Default: 10. |
| `--json` | boolean | Emit `index-entry.schema.json`-conforming records. |

This command exists for operator validation of FR-012 / FR-014 / SC-004
behavior. The production-facing surface is the (future) MCP read interface.

---

## `danni mirror-info <dataset_id>`

Print the curated-dataset record for a single dataset.

```text
danni mirror-info <dataset_id> [--json]
```

`--json` emits a `curated-dataset.schema.json`-conforming record on stdout
(useful for downstream consumers consuming the file system directly until the
MCP layer ships).
