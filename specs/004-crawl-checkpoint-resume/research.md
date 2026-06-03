# Phase 0 Research — 004-crawl-checkpoint-resume

**Date**: 2026-06-03
**Status**: Resolves the design unknowns so Phase 1 can proceed. Every decision is grounded
in the code read for this plan; functions/files are cited inline.

The spec's two clarification rounds (Session 2026-06-03 and round 2) already fix the product
shape. This document records the **engineering** decisions that implement them, in the
canonical **Decision / Rationale / Alternatives considered** form.

---

## R1 — Scope-hash: canonicalization of the campaign key (FR-003a)

**Decision**: `computeScopeHash(scope: ScopeConfig)` in a new `src/crawler/scope-hash.ts`:

1. Take the four arrays from `ScopeConfig` (`src/config/schema.ts:92–99`):
   `publishers`, `categories`, `tags`, `datasetIds` (each optional).
2. For each array: map to lowercase, trim, dedupe (Set), sort ascending (default JS string
   order over these ASCII id/slug values).
3. If **all four** normalize to empty, the canonical object is the fixed sentinel
   `{ "all": true }`; otherwise it is `{ publishers, categories, tags, datasetIds }` with the
   four normalized arrays in that fixed key order.
4. `scopeHash = sha256Hex(JSON.stringify(canonical))` using the existing
   `sha256Hex` (`src/lib/hash.ts`).

A scope change therefore yields a different hash → a **fresh** `crawl_checkpoints` row; the
prior row is retained (never deleted), per FR-003a.

**Rationale**: `ScopeConfig` already carries exactly these four arrays — no new config shape
is invented (Constitution V). Lowercase + dedupe + sort makes the hash order-insensitive and
case-insensitive so `{publishers:["A","a"]}` and `{publishers:["a"]}` map to the same
campaign, matching the clarification verbatim. JSON with a fixed key order is deterministic
and human-inspectable in the DB. Operating on ids/slugs (never on Cyrillic title fields)
keeps Constitution X intact — lowercasing an org-uri slug is lossless; lowercasing an
authoritative Bulgarian title would not be, and we never do that.

**Alternatives considered**:
- *Hash the raw `scope_filter_json` already stored on `sync_runs`* — rejected: that JSON is
  not canonicalized (array order / dupes / case would fork the campaign spuriously), and
  `sync_runs.scope_filter_json` is per-run, not per-campaign.
- *Use the empty string for empty scope* — rejected: the spec mandates a fixed **"all"
  sentinel** so a full-portal campaign has a stable, recognizable key.
- *Include the locale in the hash* — rejected for v1: locale (`bg`) affects rendered
  metadata text, not the in-scope id set; folding it in would needlessly fork campaigns.
  Noted as a follow-up if multi-locale capture is ever added.

---

## R2 — Frozen sorted id list: materializing the in-scope set under page-only pagination (FR-003, FR-004)

**Decision**: At **campaign start** (no existing checkpoint row for the scope-hash),
enumerate the full in-scope dataset-uri set once by paging
`EgovBgClient.listDatasets({ recordsPerPage: 100, pageNumber })`
(`src/crawler/egov-bg-client.ts:76–82`) until a short page, exactly as the current
`runEgovSync` loop does (`src/crawler/egov-sync.ts:191–203`) — **but with no `--max` cap on
discovery**. Collect `d.uri` for every in-scope dataset, **sort by uri**, and persist the
sorted array as `crawl_checkpoints.frozen_ids_json`. The **cursor** is the last completed
uri (`crawl_checkpoints.cursor_uri`); resume = process the sorted list strictly after the
cursor. `--max` bounds how many datasets a **session** advances, not discovery.

When `scope.datasetIds` is provided, the frozen list is exactly those uris (sorted) — no
discovery paging needed (mirrors the `opts.datasetUris` branch at `egov-sync.ts:188`).

Catalog reconciliation (FR-004): on a later session, after the frozen list is exhausted (or
on an explicit reconcile pass), re-enumerate and diff. New uris are appended to the frozen
list and processed; uris that vanished upstream are marked withdrawn via the existing
withdrawal path. Because the cursor advances over a **stable sorted uri ordering**, page
reordering between sessions can never skip a dataset.

**Rationale**: The portal's `listDatasets` is page-only (`page_number`) with no stable cursor
token, so a page index is **not** resumable — inserting/removing a dataset shifts every later
page. Freezing a sorted uri list at campaign start decouples resume from page order entirely
(the round-2 clarification: "resume is gap-free regardless of page order"). Sorting by uri
(an ASCII slug/id) gives a total order independent of upstream pagination and independent of
Cyrillic collation concerns. Storing the list once (~12k uris ≈ low hundreds of KB as a TEXT
JSON column) is cheap for SQLite and avoids re-enumerating on every session.

**Alternatives considered**:
- *Store a page-number cursor* — rejected: page-only pagination is not stable across catalog
  mutation; the spec explicitly rejects "page number" in favor of an id high-water-mark.
- *Sort by `metadata_modified` / `updated_at`* — rejected: those values are nullish on the
  egov summary (`EgovDatasetSummarySchema`, `egov-bg-schema.ts:18–26`) and mutate upstream,
  so they are not a stable ordering key.
- *Don't freeze; re-derive the id set each session* — rejected: wastes discovery requests
  every session (Constitution XI) and reintroduces the reordering hazard the freeze removes.

---

## R3 — "Already captured & unchanged" for an egov datastore resource (FR-002)

**Decision**: The egov datastore (`getResourceData`, `egov-bg-client.ts:100`) returns rows
with **no HTTP ETag / Last-Modified / 304** — the entire request is a POST whose body is the
data (`PortalHttp.postJson`, `http.ts:92`), so per-resource HTTP validators do not exist.
Therefore "unchanged" is decided at the **dataset level**:

- `egov-validator.ts` computes a stable `source_etag_or_hash` for a dataset from
  `getDatasetDetails` (`DatasetDetailsResponseSchema`, `egov-bg-schema.ts:38–61`): prefer
  `updated_at`; fold in `version` when present; fall back to `sha256Hex` of a canonical JSON
  of the consumed metadata fields (`name`, `descript`, `org_id`, `tags`, `updated_at`,
  `version`) when both are null.
- Store it in the existing `datasets.source_etag_or_hash` column (already present —
  `migrations/001_core.sql:29` — currently unused by the egov path) and mirror it on the
  checkpoint dataset row.
- **Skip-at-dataset-level** when: the freshly computed validator equals the stored one **AND**
  every checkpoint resource row for that dataset has `outcome='success'`. Otherwise the
  dataset is (re)fetched; within it, resources already marked `success` for the **current**
  validator are skipped, so only changed/missing resources are re-captured.

**Rationale**: This is exactly the round-1 clarification ("no per-resource HTTP validators;
'no fetch' relies on the dataset-level validator") and it reuses a column that already exists
for precisely this purpose (Constitution IX `source_etag_or_hash`). The fallback content-hash
guarantees a usable validator even when the portal omits `updated_at`/`version` (both are
`.nullish()` in the schema). Folding `version` in catches republications that keep the same
`updated_at`.

**Alternatives considered**:
- *Hash the datastore payload per resource and compare* — rejected for the **skip** decision:
  it requires fetching the payload, which defeats "no fetch on resume." (The content hash is
  still computed on capture for on-disk dedupe — see R5/FR-008 — just not used to decide
  whether to fetch.)
- *Treat every resume as "fetch all"* — rejected: violates SC-001 (< 1% re-fetch) and is
  disrespectful to the portal (Constitution XI).

---

## R4 — Wrapping `runEgovSync` in `beginSyncRun` and sharing the single lock (FR-007)

**Decision**: Today the CLI calls `runEgovSync` **directly**
(`src/cli/sync.ts:124–136`) — it never touches `beginSyncRun`, the `sync_runs_lock`,
`sync_runs`, `sync_run_events`, the manifest, or the notifier. Refactor so the egov path
goes through an orchestrator that mirrors `runSync` (`src/crawler/run-sync.ts:45`):

1. Call `beginSyncRun({ db, storeRoot, trigger, scopeFilter, onOverlap })`
   (`src/manifest/sync-run.ts:57`) — this acquires the single `sync_runs_lock` via
   `SyncRunsLockRepo.tryAcquire` (`sync-runs-lock.ts:25`), creates the `sync_runs` row, and
   reaps abandoned runs.
2. Pass the returned `SyncRunHandle` into `runEgovSync`; call `handle.recordEvent(...)` per
   dataset (`discovered`/`skipped_unchanged`) and per resource
   (`captured`/`skipped_unchanged`/`failed`) using the existing `EventOutcome` set
   (`sync_run_events` already includes all of these — `migrations/001_core.sql:92`).
3. On completion, `handle.end({ summaryOutcome, totals, datasetEntries })` writes the
   manifest + finalizes `sync_runs` + releases the lock; on error, `handle.abort(reason)`.
4. Dispatch the notifier on `failed`/threshold exactly as `run-sync.ts:230–256`.
5. In `cli/sync.ts`, catch `LockContentionError` → exit code 5 (parity with the CKAN branch,
   `cli/sync.ts:155–159`).

Because both paths now acquire the **same** single-row lock, egov and CKAN runs are mutually
exclusive (round-2 clarification; 001 FR-017c). This satisfies 001 FR-017a (run history) and
FR-017b (notifications) for the egov path too.

**Rationale**: The lock, audit record, events, manifest, and notifier already exist and are
battle-tested by the CKAN path; reusing them (Constitution V) is strictly better than
inventing egov-specific equivalents. `beginSyncRun` also gives crash recovery for free —
`reapAbandonedRuns` (`sync-run.ts:49`) marks a previously interrupted run `failed` and force-
releases the lock, so an interrupted crawl's lock never wedges the next session.

**Alternatives considered**:
- *Keep egov outside `beginSyncRun`, add a separate egov lock* — rejected: the spec requires
  the **single** lock so egov and CKAN cannot run concurrently against shared store state.
- *Make `runEgovSync` itself call `beginSyncRun`* (rather than an orchestrator) — viable, but
  `run-sync.ts` establishes the convention that the orchestrator owns the run lifecycle and
  the inner function owns the crawl loop; following it keeps the two paths symmetric and the
  inner function unit-testable with a fake handle.

---

## R5 — Atomic resource capture (FR-005, SC-003)

**Decision**: Replace the non-atomic write at `src/crawler/egov-sync.ts:287`
(`writeFileSync(join(opts.storeRoot, 'raw', rawPath), content)`) with the existing
`atomicWriteFile` from `src/lib/fs.ts:8` — it already does **temp file → `fsyncSync` →
`renameSync`**, which is exactly the FR-005 contract. The capture is recorded
(`resourcesRepo.recordCapture` + the checkpoint resource row marked `success`) **only after**
`atomicWriteFile` returns (i.e., after the rename succeeds). For multi-byte content the write
streams through the same primitive.

For the **safe-re-scan / on-disk reuse** path (FR-008), the egov capture stays content-
addressed-friendly: when a checkpoint is lost, the planner re-scans and, before recording a
capture, can compare the freshly serialized content's `sha256Hex` against what is on disk so
identical bytes are not rewritten (mirrors `BlobStore.put`'s reuse-on-match, `blob-store.ts:63`).

**Rationale**: `atomicWriteFile` is the project's own fsync+rename primitive and the CKAN
download path already uses the same temp→rename discipline (`http.ts:181–204`,
`BlobStore.put`). Using it makes the egov path atomic with **zero new code** for the write
itself (Constitution V) and directly satisfies the round-2 clarification ("the non-atomic
`writeFileSync` is replaced"). Recording only after rename guarantees the SC-003 invariant:
no resource is marked captured without its bytes present.

**Alternatives considered**:
- *Write to the final path then fsync* — rejected: a crash mid-write leaves a truncated file
  at the real path that could be mistaken for a complete capture (the exact failure FR-005
  forbids).
- *Route egov captures through `BlobStore.put`* (content-addressed `<sha256>.<ext>` layout) —
  considered; it would unify egov with the CKAN blob layout. Deferred: the egov layout is
  currently `raw/<dataset_uri>/<resource_uri>/raw.<ext>` and several downstream consumers
  (curate/index) already read that path. Switching layouts is a larger change than this
  feature needs; atomic-rename into the **existing** path satisfies FR-005 without a layout
  migration. Flagged as a possible later unification.

---

## R6 — `--max`, the cursor, and per-resource commit granularity (FR-003, SC-004)

**Decision**: `--max` is the per-session **dataset** batch (already parsed as a positive int
in `cli/sync.ts:67–71`). The session processes at most `--max` datasets from the frozen list
strictly after `cursor_uri`. After **each dataset** fully completes, persist
`cursor_uri = <that uri>`. After **each resource** completes (atomic write done), mark its
checkpoint resource row `success` (or `failed` with `attempts++`). Thus an interruption loses
at most the single in-flight resource (SC-004), and a session boundary is clean at a dataset
boundary.

**Rationale**: Per the round-1 clarification: "`--max` is the per-session dataset batch that
advances and persists the cursor; completion is recorded per resource." Committing per
resource is one small `UPDATE` against a rate-limited fetch — negligible cost, maximal safety.

**Alternatives considered**:
- *Commit the cursor only at session end* — rejected: an interruption would lose the whole
  session's datasets (violates SC-004).
- *`--max` counts resources* — rejected: the clarification fixes it as a **dataset** batch so
  sessions are reasoned about at dataset granularity.

---

## R7 — Retry policy and "remaining" accounting (FR-009)

**Decision**: A normal resume **skips** recorded failures — the cursor advances past a failed
dataset/resource so it never blocks progression. Each failure increments a per-row
`attempts` count on the checkpoint resource (and dataset) row, capped by a configured
`maxAttempts` (default proposed: 3). `--retry-failed` re-attempts rows whose `outcome='failed'`
and `attempts < maxAttempts`; rows at the cap are **not** retried. The `status` "remaining"
count = in-scope datasets not yet `success` **minus** capped failures (FR-009: "remaining
excludes capped failures").

**Rationale**: Direct from the round-2 clarification. The attempt cap prevents a persistently
failing unit from being hammered (Constitution XI) and keeps "remaining" honest so an
operator can see when a campaign is "done except for known-bad units."

**Alternatives considered**:
- *Auto-retry failures on every resume* — rejected: a permanently broken resource would loop
  forever and the cursor could never reach completion (violates the edge case "MUST not block
  forever").
- *Drop failures silently* — rejected: failures must stay visible for later `--retry-failed`
  (FR-009) and for the audit trail (Constitution IX).

---

## R8 — Lost or corrupted checkpoint → safe re-scan (FR-008)

**Decision**: Loading the checkpoint is defensive: the `frozen_ids_json` and the scope arrays
are Zod-validated on read (Constitution VII). If the row is missing, unparseable, or fails
validation, the planner logs a structured warning and **degrades to a full re-scan** for that
scope-hash: it re-enumerates the in-scope id set and re-processes, but before recording any
capture it reuses on-disk content (compare `sha256Hex` of the freshly serialized payload to
the existing file) so already-present-and-unchanged resources are **not** re-downloaded
needlessly. A fresh checkpoint row is then written so the next session resumes normally.

**Rationale**: The round-1 edge case requires that a lost/corrupt checkpoint still avoids
re-downloading resources already present and unchanged on disk. The content-addressed reuse
discipline (`BlobStore.put`, `blob-store.ts:63`) is the existing pattern for exactly this.
Validating JSON columns on read is the standard boundary check (data-model §5 of 001).

**Alternatives considered**:
- *Treat a corrupt checkpoint as fatal (refuse to run)* — rejected: the spec mandates
  graceful degradation to a safe re-scan, not an operational dead-end.
- *Trust the corrupt row partially* — rejected: a partially-parsed cursor could skip
  un-captured datasets (silent gap), the worst outcome for Constitution IX.

---

## R9 — Migration numbering coordination (process decision)

**Decision**: This feature needs one new migration. The next free numeric prefix **today** is
**004** (existing: `001_core`, `002_curate_enrich`, `003_index` in `migrations/`). The plan
proposes `006_crawl_checkpoint.sql`. **But** two sibling features are concurrently in flight —
`specs/002-batch-embedding/` and `specs/003-incremental-indexing/` (each currently has only
`spec.md`, so neither has authored a migration yet). The in-house runner
(`src/store/migrate.ts:16,52–96`) requires a **unique integer prefix** and enforces a
**checksum lock** (editing an applied file throws `MigrationError`). Two features both
shipping `004_*.sql` would collide.

**Resolution**: Whichever feature merges first claims `004`; the others rebase to `005`/`006`.
The implementer MUST re-confirm the next free prefix at merge time (`ls migrations/`) and
renumber the file accordingly. This is recorded in plan.md Complexity Tracking and
data-model.md §2 so it is never silently assumed.

**Rationale**: Forward-only, prefix-ordered, checksum-locked migrations are deliberately rigid
(Constitution: schema migrations checked into the repo). The rigidity is what makes the
coordination flag necessary — it is a process note, not a design flaw.

**Alternatives considered**:
- *Reserve a wide numeric band per feature now* — rejected: premature; only one migration is
  needed and the runner sorts by integer regardless of gaps.
- *Fold the checkpoint tables into an existing migration* — rejected: would change an applied
  file's checksum and fail the lock.

---

## Summary: unknowns resolved

| Item | Resolution |
|------|-----------|
| Scope-hash canonicalization | R1: SHA-256 over canonical JSON of 4 sorted+deduped+lowercased scope arrays; "all" sentinel for empty |
| Frozen id list under page-only pagination | R2: enumerate once at campaign start, sort by uri, persist; cursor = last completed uri; reconcile additions/removals on a later pass |
| "Unchanged" for an egov datastore resource | R3: dataset-level validator from `updated_at`/`version` (hash fallback) into `source_etag_or_hash`; skip when validator unchanged AND all resources captured |
| Wrapping egov in `beginSyncRun` / shared lock | R4: orchestrator mirrors `run-sync.ts`; single `sync_runs_lock`; egov+CKAN mutually exclusive |
| Atomic capture | R5: replace `writeFileSync` with existing `atomicWriteFile` (temp+fsync+rename); record only after rename |
| `--max` + cursor + per-resource commit | R6: `--max` = per-session dataset batch; commit cursor per dataset, completion per resource (≤1 lost) |
| Retry policy / "remaining" | R7: skip failures on normal resume; `--retry-failed` re-attempts up to maxAttempts; remaining excludes capped failures |
| Lost/corrupt checkpoint | R8: validate-on-read; degrade to safe re-scan with on-disk content reuse |
| Migration numbering | R9: propose `006_crawl_checkpoint.sql`; coordinate with 002/003-batch/incremental at merge time |

All Phase 0 unknowns are resolved. Phase 1 may proceed.
