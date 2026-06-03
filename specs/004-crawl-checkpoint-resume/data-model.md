# Data Model — 004-crawl-checkpoint-resume

**Date**: 2026-06-03
**Scope**: New durable `crawl_checkpoint` table family for resumable full-portal crawls.
Extends the 001 schema (`migrations/001_core.sql`). No change to the on-disk blob layout;
no change to existing tables' columns. Conventions follow 001 data-model.md.

> **Naming**: `snake_case` SQL identifiers; ISO-8601 UTC `TEXT` timestamps; JSON stored as
> `TEXT` and Zod-validated on read.

> **Reused existing column**: `datasets.source_etag_or_hash` (`migrations/001_core.sql:29`) —
> already present, currently unused by the egov path — now carries the egov dataset-level
> validator (research.md R3). No migration needed for it.

---

## 1. Entities

The spec's Key Entities are **Crawl checkpoint** (campaign-level) and **Crawl session**. A
session is the per-invocation `sync_runs` row that already exists (001 §1.4) — no new table;
the checkpoint links to the run that last advanced it. The checkpoint itself decomposes into
three tables: one campaign row, one per in-scope dataset, one per resource (the per-dataset
**and** per-resource granularity the spec requires).

### 1.1 `crawl_checkpoints` — campaign (one row per scope-hash) (FR-001, FR-003, FR-003a)

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `scope_hash` | TEXT | PRIMARY KEY | SHA-256 hex from `computeScopeHash(scope)` (FR-003a); empty scope → "all" sentinel hash |
| `scope_json` | TEXT | NOT NULL | Canonical JSON of the 4 normalized scope arrays (or `{"all":true}`); Zod-validated on read |
| `frozen_ids_json` | TEXT | NOT NULL DEFAULT '[]' | Frozen **sorted** in-scope dataset-uri array (FR-003); Zod `string[]` on read |
| `cursor_uri` | TEXT | | Last completed dataset uri (the high-water-mark); NULL before the first dataset completes |
| `total_datasets` | INTEGER | NOT NULL DEFAULT 0 | `length(frozen_ids_json)` snapshot for fast progress (FR-006) |
| `max_attempts` | INTEGER | NOT NULL DEFAULT 3 CHECK (max_attempts >= 1) | Per-row failure cap (FR-009) |
| `status` | TEXT | NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')) | `completed` once cursor passes the last frozen id |
| `created_at` | TEXT | NOT NULL | Campaign start |
| `updated_at` | TEXT | NOT NULL | Last session that advanced the checkpoint |
| `last_run_id` | TEXT | | The `sync_runs.id` of the most recent session (FK by convention, not enforced — runs may be reaped) |
| `reconciled_at` | TEXT | | Last time the frozen list was diffed against the live catalog (FR-004) |

**Indexes**: `(status)`.

**Invariants**:
- A scope change → a **new** `scope_hash` → a new row; the prior row is retained (FR-003a).
- `frozen_ids_json` is written once at campaign start and only **appended to** on
  reconciliation (FR-004); it is never reordered (resume gap-freeness depends on a stable
  order — research.md R2).
- `cursor_uri`, when non-NULL, MUST be a member of `frozen_ids_json`.

### 1.2 `crawl_checkpoint_datasets` — per-dataset completion (FR-001, FR-002)

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `scope_hash` | TEXT | NOT NULL REFERENCES `crawl_checkpoints(scope_hash)` ON DELETE CASCADE | Campaign |
| `dataset_uri` | TEXT | NOT NULL | data.egov.bg dataset uri (= `datasets.id` for egov) |
| `validator` | TEXT | | Dataset-level `source_etag_or_hash` at last capture (research.md R3); NULL until first visit |
| `outcome` | TEXT | NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','complete','failed')) | `complete` = validator unchanged AND all resources success |
| `attempts` | INTEGER | NOT NULL DEFAULT 0 | Increment on each failed visit (FR-009) |
| `resource_count` | INTEGER | NOT NULL DEFAULT 0 | Resources discovered for this dataset |
| `captured_count` | INTEGER | NOT NULL DEFAULT 0 | Resources with `outcome='success'` |
| `failed_count` | INTEGER | NOT NULL DEFAULT 0 | Resources with `outcome='failed'` |
| `first_seen_at` | TEXT | NOT NULL | First session that listed this dataset |
| `last_visited_at` | TEXT | | Last session that processed it |
| `last_failure_reason` | TEXT | | Set when `outcome='failed'` |
| PRIMARY KEY | | (scope_hash, dataset_uri) | One row per dataset per campaign |

**Indexes**: `(scope_hash, outcome)` — drives "remaining" and `--retry-failed` queries.

### 1.3 `crawl_checkpoint_resources` — per-resource completion (FR-001, FR-005, SC-004)

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `scope_hash` | TEXT | NOT NULL REFERENCES `crawl_checkpoints(scope_hash)` ON DELETE CASCADE | Campaign |
| `dataset_uri` | TEXT | NOT NULL | Parent dataset |
| `resource_uri` | TEXT | NOT NULL | data.egov.bg resource uri (= `resources.id`) |
| `outcome` | TEXT | NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','success','failed')) | `success` recorded **only after** atomic rename (FR-005, SC-003) |
| `attempts` | INTEGER | NOT NULL DEFAULT 0 | Increment on each failed capture (FR-009) |
| `sha256` | TEXT | | Content hash of the last successful capture (on-disk reuse for FR-008) |
| `validator` | TEXT | | Dataset validator under which this success was recorded — a validator change invalidates the success (research.md R3) |
| `captured_at` | TEXT | | Set on `success` |
| `last_failure_reason` | TEXT | | Set when `outcome='failed'` |
| PRIMARY KEY | | (scope_hash, dataset_uri, resource_uri) | One row per resource per campaign |
| FOREIGN KEY | | (scope_hash, dataset_uri) REFERENCES `crawl_checkpoint_datasets(scope_hash, dataset_uri)` ON DELETE CASCADE | |

**Indexes**: `(scope_hash, dataset_uri)` — covered by the composite FK / PK prefix.

---

## 2. Proposed migration

**File**: `migrations/006_crawl_checkpoint.sql`

> **⚠ Numbering coordination (research.md R9 / plan.md Complexity Tracking)**: the next free
> prefix **today** is `004` (existing: `001_core`, `002_curate_enrich`, `003_index`). Sibling
> features `002-batch-embedding` and `003-incremental-indexing` are concurrently in flight and
> have **not** yet authored migrations. The runner (`src/store/migrate.ts`) requires unique
> integer prefixes and checksum-locks applied files. **The implementer MUST re-confirm the
> next free prefix at merge time (`ls migrations/`) and renumber to `005`/`006` if a sibling
> feature's migration lands first.**

**Creates**:
- Table `crawl_checkpoints` (§1.1) + index `idx_crawl_checkpoints_status`.
- Table `crawl_checkpoint_datasets` (§1.2) + index `idx_ccp_datasets_outcome` on
  `(scope_hash, outcome)`.
- Table `crawl_checkpoint_resources` (§1.3).

The migration is **additive only** — no `ALTER`/`DROP` on existing tables, so it cannot
conflict with 001/002/003 content (only the filename prefix must be unique). Foreign keys use
`ON DELETE CASCADE` so removing a stale campaign row (operator-initiated cleanup) drops its
children atomically; `PRAGMA foreign_keys = ON` is already set at every connection open
(001 data-model §6).

Sketch (final SQL authored in Phase 1):

```sql
-- 006_crawl_checkpoint.sql — durable cross-session crawl checkpoint (004-crawl-checkpoint-resume)
CREATE TABLE crawl_checkpoints (
  scope_hash TEXT PRIMARY KEY,
  scope_json TEXT NOT NULL,
  frozen_ids_json TEXT NOT NULL DEFAULT '[]',
  cursor_uri TEXT,
  total_datasets INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_id TEXT,
  reconciled_at TEXT
);
CREATE INDEX idx_crawl_checkpoints_status ON crawl_checkpoints(status);

CREATE TABLE crawl_checkpoint_datasets (
  scope_hash TEXT NOT NULL REFERENCES crawl_checkpoints(scope_hash) ON DELETE CASCADE,
  dataset_uri TEXT NOT NULL,
  validator TEXT,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','complete','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  resource_count INTEGER NOT NULL DEFAULT 0,
  captured_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_visited_at TEXT,
  last_failure_reason TEXT,
  PRIMARY KEY (scope_hash, dataset_uri)
);
CREATE INDEX idx_ccp_datasets_outcome ON crawl_checkpoint_datasets(scope_hash, outcome);

CREATE TABLE crawl_checkpoint_resources (
  scope_hash TEXT NOT NULL REFERENCES crawl_checkpoints(scope_hash) ON DELETE CASCADE,
  dataset_uri TEXT NOT NULL,
  resource_uri TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','success','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  validator TEXT,
  captured_at TEXT,
  last_failure_reason TEXT,
  PRIMARY KEY (scope_hash, dataset_uri, resource_uri),
  FOREIGN KEY (scope_hash, dataset_uri)
    REFERENCES crawl_checkpoint_datasets(scope_hash, dataset_uri) ON DELETE CASCADE
);
```

---

## 3. State transitions

### 3.1 Checkpoint dataset outcome

```
pending ──(validator unchanged AND all resources success)──► complete
   │                                                            │
   │                                                            └─(upstream validator changes)─► pending (re-fetch)
   └──(visit fails, attempts < max)──► pending (retry-eligible)
   └──(visit fails, attempts = max)──► failed (skipped on normal resume; --retry-failed ineligible at cap)
```

### 3.2 Checkpoint resource outcome

```
pending ──(atomic write + rename ok)──► success   (recorded ONLY after rename — FR-005/SC-003)
   │
   └──(capture error, attempts++ )──► failed
              │
              ├─ normal resume: cursor advances past it (FR-009)
              └─ --retry-failed AND attempts < max_attempts: back to pending
```

### 3.3 Campaign status

```
active ──(cursor passes last frozen id, no retry-eligible failures)──► completed
   ▲                                                                       │
   └──(reconcile appends new ids OR --retry-failed re-opens a failure)─────┘
```

A re-invocation of a `completed` campaign with no upstream change performs **zero** captures
and reports up-to-date (SC-005): every dataset's validator matches and every resource is
`success`.

---

## 4. Validation rules (Constitution VII)

Zod boundaries introduced by this feature:

1. **CLI args** (`src/cli/sync.ts`): `--max` (already validated as positive int), new
   `--retry-failed` (boolean flag).
2. **Persisted checkpoint JSON on read** (`src/store/repos/crawl-checkpoints.ts`):
   `frozen_ids_json` validated as `z.array(z.string().min(1))`; `scope_json` validated
   against a canonical-scope schema (the 4 arrays or the `{all:true}` sentinel). A validation
   failure triggers the safe-re-scan degradation (FR-008, research.md R8) rather than a crash.
3. **Scope-hash input** (`src/crawler/scope-hash.ts`): consumes the already-Zod-validated
   `ScopeConfig` (`ScopeConfigSchema`, `src/config/schema.ts:92`) — no re-validation needed,
   only canonicalization.

---

## 5. Relationship to existing tables (ER summary)

```
crawl_checkpoints (1, by scope_hash)
   ├──< crawl_checkpoint_datasets   (scope_hash, dataset_uri)
   │        └──< crawl_checkpoint_resources (scope_hash, dataset_uri, resource_uri)
   └── last_run_id ─ ─ ─► sync_runs(id)        (by convention; not FK — runs may be reaped)

dataset_uri  ─ ─ ─► datasets(id)               (logical; datasets row created by the same run)
resource_uri ─ ─ ─► resources(id)              (logical; resources row created by the same run)
datasets.source_etag_or_hash  ◄── dataset validator written by egov-validator.ts (reused column)
```

The checkpoint tables are **derived progress state** keyed by uri strings, deliberately **not**
foreign-keyed to `datasets`/`resources`: a campaign may list a dataset uri before its
`datasets` row exists (discovery precedes capture), and withdrawn datasets must remain
referenceable in the checkpoint for audit — the same rationale 001 used for
`sync_run_events.dataset_id` being non-FK (001 data-model §1.5).
