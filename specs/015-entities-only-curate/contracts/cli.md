# CLI Contract — `danni curate --entities-only` (015)

This feature adds **one flag** to the existing `danni curate` command. It introduces no new
command, no new exit code, no new JSON schema, and no portal endpoint. The shape and exit-code
conventions below are inherited from the canonical CLI contract
(`specs/001-egov-data-sync/contracts/cli.md`); only the `--entities-only` flag is new.

> **Exit codes** (unchanged, stable across releases):
> - `0` — success
> - `2` — usage error (bad/unknown flag)
> - `4` — outright failure during the run

---

## `danni curate` (updated)

Re-curate the existing local mirror without re-fetching from the portal. With `--entities-only`,
re-run **only** entity extraction + cross-dataset linking + entity-relation materialization,
skipping resource parsing and translation.

```text
danni curate [--datasets <id1,id2,...>] [--since <iso>] [--curator-version <v>] [--entities-only]
```

| Flag | Type | Notes |
|---|---|---|
| `--datasets` | comma-list | Restrict to specific dataset IDs. Default: all active datasets. (unchanged) |
| `--since` | ISO-8601 | Only re-curate datasets touched since this time. (unchanged) |
| `--curator-version` | string | Re-run with a specific curator version. Default `0.1.0`. (unchanged) |
| `--entities-only` | boolean | **NEW.** Re-run only the extractors + cross-dataset linking + entity-relation materialization. Skips the per-resource parse loop (the memory hog) and skips translation. The CLI does **not** construct a translator in this mode, so the run needs no translation backend / LAN access. Combinable with `--datasets` / `--since` / `--curator-version`. |

**Behavior with `--entities-only`**:

- Does **not** parse any captured resource → writes no `curated_artifacts` rows; the result's
  `curated` and `uncurated` are `0`.
- Does **not** translate → writes no `translations`; `translationsWritten` is `0`. No translator is
  built (no `enrichment.translator` endpoint/LAN configuration is required).
- **Does** re-assert `dataset_entities`, `dataset_links`, and `entity_relations` from
  dataset/resource metadata rows. All three writes are PK-guarded `INSERT OR REPLACE`, so running
  over the whole catalog is idempotent (safe to re-run).
- Emits the same `RunCurateResult` JSON line to stdout as a full curate (with parse/translation
  counts at `0`), and exits `0` on success / `4` on failure / `2` on a usage error — unchanged
  semantics.

**Behavior without `--entities-only`** (unchanged): parses every successfully-captured resource
into `curated_artifacts`, builds a translator from `config.enrichment.translator`, and writes
`translations` in addition to the entity/link/relation upserts.

**Memory note**: a full `danni curate` re-parses every captured resource into memory (≈20 GB RSS
on the ~16k-resource live mirror — OOM-prone); `--entities-only` runs at ≈140 MB RSS because it
never enters the parse loop. Use `--entities-only` to refresh entities after an extractor/gazetteer
change; use a full `danni curate` when resources actually need (re)parsing or translations need
(re)writing.
