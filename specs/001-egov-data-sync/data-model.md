# Data Model — 001-egov-data-sync

**Date**: 2026-05-08
**Scope**: SQLite schema + on-disk blob layout for the local mirror. Authoritative
field set; column types, constraints, and relationships. JSON-shaped contracts
for read consumers live under `contracts/` and reference these tables.

> **Naming convention**: `snake_case` for SQL identifiers; `kebab-case` for file
> paths; `camelCase` for TypeScript fields exposed in JSON contracts.

> **Time**: every timestamp column is ISO-8601 UTC (`TEXT`, e.g.
> `2026-05-08T10:11:12.345Z`). SQLite stores them as TEXT for portability and
> human-readability of the file.

---

## 1. Entities

The spec lists 11 key entities. Each maps to a SQL table (or, where the entity
is purely on-disk, a documented file-system contract). Table-level columns are
declared below; FTS5 / `sqlite-vec` virtual tables for indexing are listed
separately in §3.

### 1.1 `datasets` — Dataset (spec entity)

The publication unit on data.egov.bg.

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Portal dataset ID (CKAN UUID or slug) |
| `slug` | TEXT | NOT NULL | CKAN `name` field; stable URL slug |
| `title_bg` | TEXT | NOT NULL | Authoritative Bulgarian title; never mutated |
| `description_bg` | TEXT | | Authoritative Bulgarian description; may be empty |
| `publisher_id` | TEXT | REFERENCES `organizations(id)` | CKAN organization ID |
| `license_id` | TEXT | | CKAN `license_id` |
| `tags_json` | TEXT | NOT NULL DEFAULT '[]' | JSON array of CKAN tag names |
| `groups_json` | TEXT | NOT NULL DEFAULT '[]' | JSON array of CKAN group IDs |
| `source_url` | TEXT | NOT NULL | Canonical portal URL for the dataset |
| `metadata_created` | TEXT | | CKAN `metadata_created` (upstream value, not local capture) |
| `metadata_modified` | TEXT | | CKAN `metadata_modified` (upstream value) |
| `first_seen_at` | TEXT | NOT NULL | First Sync Run that captured this dataset |
| `last_synced_at` | TEXT | NOT NULL | Most recent Sync Run that touched this dataset (per Principle IX) |
| `source_etag_or_hash` | TEXT | | ETag from upstream, or hash of the canonical metadata payload (Principle IX) |
| `lifecycle_state` | TEXT | NOT NULL CHECK (lifecycle_state IN ('active','withdrawn','out_of_scope')) | FR-016, FR-018a |
| `lifecycle_changed_at` | TEXT | | When `lifecycle_state` last transitioned |
| `withdrawn_reason` | TEXT | | Set when `lifecycle_state='withdrawn'` |

**Indexes**: `(publisher_id)`, `(lifecycle_state)`, `(metadata_modified)`,
`(last_synced_at)`.

**Invariants**:
- `title_bg`, `description_bg`, `tags_json`, `groups_json`, `metadata_*`,
  `source_url`, `publisher_id`, `license_id` are never updated to lossy values:
  if a Sync Run observes a different value, the row is updated, the prior
  value is captured in `dataset_revisions` (§1.10), and `last_synced_at` is
  refreshed.
- A dataset transitions to `withdrawn` only via the upstream-deletion detector
  (FR-016). Local code never deletes the row.

### 1.2 `resources` — Resource (spec entity)

A downloadable file or endpoint linked from a Dataset.

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Portal resource ID |
| `dataset_id` | TEXT | NOT NULL REFERENCES `datasets(id)` | |
| `position` | INTEGER | NOT NULL DEFAULT 0 | Order within dataset |
| `name` | TEXT | | Human label from CKAN |
| `description_bg` | TEXT | | Authoritative; never mutated |
| `declared_format` | TEXT | | CKAN `format` (e.g. `CSV`, `JSON`) |
| `detected_content_type` | TEXT | | From `Content-Type` header on fetch |
| `detected_format` | TEXT | | Sniffed from content (FR edge case: redirect/wrong header) |
| `source_url` | TEXT | NOT NULL | Resource URL (may be off-portal) |
| `bytes` | INTEGER | | Size on disk; null until first capture |
| `sha256` | TEXT | | Content hash; null until first capture |
| `raw_path` | TEXT | | Relative path under `store/raw/` |
| `etag` | TEXT | | Last seen `ETag` |
| `last_modified` | TEXT | | Last seen `Last-Modified` |
| `first_seen_at` | TEXT | NOT NULL | |
| `last_synced_at` | TEXT | NOT NULL | Principle IX |
| `last_outcome` | TEXT | NOT NULL CHECK (last_outcome IN ('success','failure','skipped_unchanged','withdrawn','out_of_scope')) | Per-resource outcome of the most recent Sync Run that touched it |
| `last_failure_reason` | TEXT | | Set when `last_outcome='failure'` |
| `lifecycle_state` | TEXT | NOT NULL CHECK (lifecycle_state IN ('active','withdrawn','out_of_scope')) | Mirrors dataset lifecycle for the resource |

**Indexes**: `(dataset_id)`, `(sha256)`, `(last_synced_at)`, `(last_outcome)`.

### 1.3 `organizations` — Publisher

Authoritative CKAN organization (also acts as an Entity of kind
`organization`; see §1.6).

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | CKAN org ID |
| `slug` | TEXT | NOT NULL | CKAN `name` |
| `title_bg` | TEXT | NOT NULL | |
| `description_bg` | TEXT | | |
| `source_url` | TEXT | NOT NULL | |
| `first_seen_at` | TEXT | NOT NULL | |
| `last_synced_at` | TEXT | NOT NULL | |

### 1.4 `sync_runs` — Sync Run (spec entity)

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | ULID |
| `started_at` | TEXT | NOT NULL | |
| `ended_at` | TEXT | | Null while in-progress |
| `trigger` | TEXT | NOT NULL CHECK (trigger IN ('manual','scheduled')) | |
| `scope_filter_json` | TEXT | NOT NULL | Scope filter applied (FR-018) |
| `summary_outcome` | TEXT | CHECK (summary_outcome IN ('success','partial','failed') OR summary_outcome IS NULL) | Null while in-progress |
| `discovered_count` | INTEGER | NOT NULL DEFAULT 0 | |
| `captured_count` | INTEGER | NOT NULL DEFAULT 0 | |
| `skipped_unchanged_count` | INTEGER | NOT NULL DEFAULT 0 | |
| `failed_count` | INTEGER | NOT NULL DEFAULT 0 | |
| `withdrawn_count` | INTEGER | NOT NULL DEFAULT 0 | |
| `out_of_scope_count` | INTEGER | NOT NULL DEFAULT 0 | |
| `manifest_path` | TEXT | | `store/manifest/<id>.json`; null while in-progress |
| `notes` | TEXT | | Free-text operator notes (e.g. throttle events) |

**Indexes**: `(started_at)`, `(summary_outcome)`.

### 1.5 `sync_run_events` — Per-resource events within a Sync Run

The Manifest's per-resource detail is durable here for query (the on-disk
`store/manifest/<run_id>.json` mirrors this view for archive/read consumers).

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `run_id` | TEXT | NOT NULL REFERENCES `sync_runs(id)` | |
| `dataset_id` | TEXT | NOT NULL | Not FK — datasets withdrawn upstream may still be referenced |
| `resource_id` | TEXT | | Null when the event applies at dataset level only |
| `event_at` | TEXT | NOT NULL | |
| `outcome` | TEXT | NOT NULL CHECK (outcome IN ('captured','skipped_unchanged','failed','withdrawn','out_of_scope')) | |
| `bytes` | INTEGER | | |
| `sha256` | TEXT | | |
| `failure_reason` | TEXT | | Set when outcome='failed' |
| `http_status` | INTEGER | | Last HTTP status seen (if applicable) |
| PRIMARY KEY | | (run_id, dataset_id, COALESCE(resource_id,'')) | |

### 1.6 `entities` — Entity (spec entity, FR-019a)

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Canonical entity ID, deterministic per kind |
| `kind` | TEXT | NOT NULL CHECK (kind IN ('organization','geographic_unit','time_period','named_subject','tag','group')) | |
| `canonical_label_bg` | TEXT | NOT NULL | Authoritative Bulgarian label |
| `canonical_label_en` | TEXT | | Optional English label (gazetteer-supplied or translated) |
| `attributes_json` | TEXT | NOT NULL DEFAULT '{}' | Kind-specific attributes (e.g. ISO 3166-2 code, time-period bounds) |

Deterministic IDs:
- `organization`: `org:<ckan_org_id>`
- `geographic_unit`: `geo:<gazetteer_id>` (e.g. `geo:bg-municipality-sofia`)
- `time_period`: `time:<iso8601>` (point) or `time:<start>/<end>` (range)
- `named_subject` / `tag` / `group`: `<kind>:<slug>`

### 1.7 `dataset_entities` — Dataset ↔ Entity attachment (FR-019a)

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `dataset_id` | TEXT | NOT NULL REFERENCES `datasets(id)` | |
| `entity_id` | TEXT | NOT NULL REFERENCES `entities(id)` | |
| `extractor` | TEXT | NOT NULL | E.g. `ckan_organization`, `bg_admin_gazetteer` |
| `confidence` | REAL | NOT NULL CHECK (confidence > 0 AND confidence <= 1) | FR-019d |
| `evidence_json` | TEXT | NOT NULL DEFAULT '{}' | Where in the dataset the entity was found (column, value, span) |
| `attached_at` | TEXT | NOT NULL | |
| PRIMARY KEY | | (dataset_id, entity_id, extractor) | Same entity may be attached by multiple extractors |

### 1.8 `dataset_links` — Cross-Dataset Link (spec entity, FR-019b)

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `dataset_a_id` | TEXT | NOT NULL REFERENCES `datasets(id)` | |
| `dataset_b_id` | TEXT | NOT NULL REFERENCES `datasets(id)` | |
| `via_entity_id` | TEXT | NOT NULL REFERENCES `entities(id)` | |
| `heuristic` | TEXT | NOT NULL | E.g. `shared_publisher`, `shared_municipality` |
| `confidence` | REAL | NOT NULL CHECK (confidence > 0 AND confidence <= 1) | FR-019d |
| `created_at` | TEXT | NOT NULL | |
| PRIMARY KEY | | (dataset_a_id, dataset_b_id, via_entity_id, heuristic) | |
| CHECK | | dataset_a_id < dataset_b_id | Canonical undirected pair ordering — avoids duplicate edges |

### 1.9 `translations` — Translation (spec entity, FR-019c)

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `subject_kind` | TEXT | NOT NULL CHECK (subject_kind IN ('dataset_title','dataset_description','resource_description','entity_label')) | |
| `subject_id` | TEXT | NOT NULL | Foreign-id depending on `subject_kind` |
| `text_bg` | TEXT | NOT NULL | Original — copied here so the translation row is self-contained for audit |
| `text_en` | TEXT | NOT NULL | May be empty when translation declined |
| `translator` | TEXT | NOT NULL | Provenance (FR-019d): `local-marianmt:<version>`, `hosted-api:<id>` |
| `confidence` | REAL | NOT NULL CHECK (confidence >= 0 AND confidence <= 1) | 0.0 represents "declined / low-confidence" |
| `created_at` | TEXT | NOT NULL | |
| UNIQUE | | (subject_kind, subject_id, translator) | One translation per subject per translator |

**Invariant** (Principle X, FR-019c): the original Bulgarian field on
`datasets`/`resources`/`entities` is never replaced by `text_en`. Read
consumers compose the two from the source table + `translations`.

### 1.10 `dataset_revisions` — Authoritative-field revision history

Captures upstream changes to authoritative fields without overwriting them
silently. Append-only.

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `dataset_id` | TEXT | NOT NULL REFERENCES `datasets(id)` | |
| `observed_at` | TEXT | NOT NULL | When the change was detected |
| `field` | TEXT | NOT NULL | Field name (e.g. `title_bg`) |
| `old_value` | TEXT | | |
| `new_value` | TEXT | | |
| `run_id` | TEXT | NOT NULL REFERENCES `sync_runs(id)` | |

### 1.11 `curated_artifacts` — Curated Artifact (spec entity)

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | ULID |
| `dataset_id` | TEXT | NOT NULL REFERENCES `datasets(id)` | |
| `resource_id` | TEXT | NOT NULL REFERENCES `resources(id)` | |
| `kind` | TEXT | NOT NULL CHECK (kind IN ('tabular','json','geojson','xml','text','uncurated')) | |
| `path` | TEXT | NOT NULL | Relative to `store/curated/` |
| `schema_json` | TEXT | NOT NULL DEFAULT '{}' | Declared schema (column → type for tabular; root shape for JSON/GeoJSON) |
| `transform_rules_json` | TEXT | NOT NULL DEFAULT '[]' | Ordered list of rule applications (FR-009: "MUST record any normalization rules applied") |
| `encoding` | TEXT | NOT NULL DEFAULT 'utf-8' | Always `utf-8` for non-uncurated kinds (FR-008) |
| `uncurated_reason` | TEXT | | Set when `kind='uncurated'` (FR-010) |
| `curator_version` | TEXT | NOT NULL | The curator code version that produced this artifact |
| `created_at` | TEXT | NOT NULL | |
| `last_curated_at` | TEXT | NOT NULL | Most recent re-curation (FR-011) |
| UNIQUE | | (resource_id, curator_version) | Re-curating with the same version is idempotent |

### 1.12 `scope_filters` — Scope Filter snapshot (spec entity)

Persisted alongside each Sync Run as `scope_filter_json` on `sync_runs`. No
separate table — the filter is run-scoped. The current effective filter
(applied to scheduled runs) lives in the config file and is logged on each
run.

### 1.13 `schedules` — Schedule (spec entity)

The configured cadence. Stored as a single row (operator may have one active
schedule); historical schedules captured in `schedule_history`.

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY CHECK (id = 1) | Single-row table |
| `cron_expression` | TEXT | | Null = scheduling disabled |
| `timezone` | TEXT | NOT NULL DEFAULT 'Europe/Sofia' | |
| `on_overlap` | TEXT | NOT NULL CHECK (on_overlap IN ('skip','queue')) | FR-017c |
| `failure_rate_threshold` | REAL | NOT NULL DEFAULT 0.05 | FR-017b |
| `notifier` | TEXT | NOT NULL DEFAULT 'stderr' | R9 |
| `notifier_config_json` | TEXT | NOT NULL DEFAULT '{}' | |
| `updated_at` | TEXT | NOT NULL | |

### 1.14 `sync_runs_lock` — single-row advisory lock for FR-017c

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY CHECK (id = 1) | |
| `is_locked` | INTEGER | NOT NULL CHECK (is_locked IN (0,1)) | |
| `held_by_run_id` | TEXT | | FK by convention (not enforced) |
| `acquired_at` | TEXT | | |

### 1.15 `schema_migrations` — Migration history

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `version` | INTEGER | PRIMARY KEY | Migration file numeric prefix |
| `name` | TEXT | NOT NULL | |
| `applied_at` | TEXT | NOT NULL | |

### 1.16 `notifications` — Outbound notification audit (FR-017b)

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `run_id` | TEXT | NOT NULL REFERENCES `sync_runs(id)` | |
| `kind` | TEXT | NOT NULL CHECK (kind IN ('run_failed','threshold_exceeded')) | |
| `channel` | TEXT | NOT NULL | E.g. `stderr`, `webhook:<url>` |
| `delivered_at` | TEXT | NOT NULL | |
| `payload_json` | TEXT | NOT NULL | |

---

## 2. State transitions

### 2.1 Dataset lifecycle (FR-016, FR-018a)

```
                      ┌──────────────────────────────────┐
                      │                                  │
   (first capture)    │                                  │
   ───────────────► active ──── upstream missing ──► withdrawn
                      │                                  ▲
                      │                                  │
                      └── scope filter excludes ──► out_of_scope
                                  ▲                  │
                                  │                  │
                                  └─ scope re-includes (back to active)
```

- Transition to `withdrawn`: detected by Sync Run when `package_show` returns
  `404 Not Found` or `package_search` no longer lists the dataset for two
  consecutive runs (one-shot 404 may be transient).
- Transition to `out_of_scope`: detected when the active scope filter excludes
  a dataset that was previously in scope.
- Captured raw bytes are **never** deleted on either transition (Principle IX
  audit trail; FR-016 reproducibility; FR-018a "without deleting captured
  copies").

### 2.2 Sync Run lifecycle

```
created ──► running ──► (success | partial | failed)
                  │
                  └── crash/interrupt ──► running with stale lock ──►
                       next run reaper marks the prior run 'failed'
                       with reason='abandoned' and releases the lock
```

### 2.3 Resource per-run outcome (FR-003, FR-006)

`captured` — fresh bytes written or replaced
`skipped_unchanged` — 304 from upstream, or content hash matched prior capture
`failed` — any non-recoverable error after retries
`withdrawn` — resource present in prior run but absent in current
`out_of_scope` — dataset excluded by scope filter; resource untouched

---

## 3. FTS5 + vector index virtual tables

### 3.1 `datasets_fts` (FTS5)

```sql
CREATE VIRTUAL TABLE datasets_fts USING fts5(
  dataset_id UNINDEXED,
  title_bg,
  title_en,
  description_bg,
  description_en,
  publisher_label,
  tag_labels,
  group_labels,
  column_labels,         -- aggregated from curated tabular artifacts
  entity_labels,         -- aggregated canonical labels of attached entities
  tokenize = 'unicode61 remove_diacritics 0'
);
```

Repopulated incrementally on every Sync Run touching a dataset (FR-015).
Cyrillic preservation guaranteed by `remove_diacritics 0`.

### 3.2 `dataset_embeddings` (sqlite-vec)

```sql
CREATE VIRTUAL TABLE dataset_embeddings USING vec0(
  dataset_id TEXT PRIMARY KEY,
  embedding FLOAT[<dim>]   -- <dim> recorded in embeddings_meta
);
```

Source text = concatenation of `title_bg + title_en + description_bg +
description_en + entity_labels + column_labels`. Re-embedded on dataset
change. The model identity, version, and dimension are recorded in
`embeddings_meta` (single-row table); switching models triggers a full
incremental rebuild.

### 3.3 `embeddings_meta`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK CHECK (id = 1) | Single-row |
| `model_id` | TEXT | E.g. `local-onnx:paraphrase-multilingual-MiniLM-L12-v2` |
| `dimension` | INTEGER | |
| `updated_at` | TEXT | |

---

## 4. On-disk blob layout

```
store/
├── danni.sqlite                       # All structured data above
├── raw/
│   └── <dataset_id>/
│       └── <resource_id>/
│           └── <sha256>.<ext>         # Byte-faithful capture; content-addressed
├── curated/
│   └── <dataset_id>/
│       └── <resource_id>/
│           ├── data.ndjson             # tabular kind
│           ├── data.json               # json / geojson kinds
│           └── schema.json             # mirror of curated_artifacts.schema_json
└── manifest/
    └── <run_id>.json                   # See contracts/manifest.schema.json
```

**Invariants**:
- `store/raw/.../<sha256>.<ext>` files are **immutable** once written. If the
  same SHA-256 is observed for an already-stored file, the existing file is
  reused (FR-004) and only DB freshness columns are updated.
- `store/curated/.../*` may be overwritten on re-curation (FR-011); the
  governing record is `curated_artifacts.last_curated_at`.
- `store/manifest/<run_id>.json` is **append-once**: written once when the
  Sync Run terminates and never modified.

---

## 5. Validation rules summarized

The constitution requires Zod validation at each boundary. The relevant
boundaries here:

1. **Portal response ingest** (`src/crawler/`): every CKAN response validated
   against the schema captured in `specs/portal-api/`. Rejected responses are
   logged with the run ID and the dataset/resource skipped with `last_outcome
   = 'failure'`, `last_failure_reason = 'schema_violation:<details>'`.
2. **Persisted record load** (`src/store/`): JSON columns (`tags_json`,
   `groups_json`, `attributes_json`, `evidence_json`, `transform_rules_json`,
   `payload_json`, `scope_filter_json`, `schema_json`, `notifier_config_json`)
   validated against typed Zod schemas at read time (Principle VII).
3. **CLI args + config file** (`src/cli/`, `src/config/`): Zod-validated at
   startup — fail fast on misconfiguration (Principle VII).
4. **Read consumer contracts**: emitted JSON (manifest, curated dataset, index
   entry — see `contracts/`) validated against `contracts/*.schema.json` in
   integration tests to guarantee contract stability across releases.

---

## 6. Relationships overview (ER summary)

```
organizations (1) ──< datasets (1) ──< resources
                             │
                             ├──< curated_artifacts ── (1:1) → resources
                             │
                             ├──< dataset_entities >── entities
                             │
                             ├──< dataset_links >── (datasets via entities)
                             │
                             └──< dataset_revisions

sync_runs (1) ──< sync_run_events  ── (datasets, resources)
                             │
                             └── (manifest_path → store/manifest/<id>.json)

translations  ── (subject_kind, subject_id) → datasets / resources / entities
```

All foreign keys are enforced (`PRAGMA foreign_keys = ON;` set at every
connection open).
