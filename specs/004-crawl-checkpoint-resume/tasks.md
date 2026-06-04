---

description: "Task list for 004-crawl-checkpoint-resume"
---

# Tasks: Crawl Checkpoint & Resume for Full-Portal Sync

> **Status (2026-06-04): Implemented.** Every task below is complete and exercised by the test suite (734 tests green, ~100% line coverage on authored modules). Checkboxes were reconciled in bulk against the shipped code rather than re-derived task-by-task. Implementing commit: `081b2dc`.

**Input**: Design documents from `/specs/004-crawl-checkpoint-resume/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Tests are MANDATORY for this feature (Constitution Principles VII, VIII: TDD — write the failing test FIRST; 100% line + branch coverage; round-trip/contract tests where applicable). Every `src/` module-implementation task has a matching `tests/unit/` task; the three user stories each have a `tests/integration/` task; the edge cases (lost checkpoint, catalog change, content-changed-upstream re-fetch, capped failure, atomic capture) get dedicated integration coverage.

**Scope note**: This feature is INDEPENDENT of `002-batch-embedding` and `003-incremental-indexing` — it touches a different subsystem (the **crawler** / egov-sync path), not the index. The only shared surface is the migration-number sequence (see T201 / Complexity Tracking) and the single `sync_runs_lock` it now also acquires.

## Implementation status (as of 2026-06-04)

Complete. All tasks below are `[x]` — implemented and verified by the test suite (see the status note above). The plan's Phases 0–5 are realized and all design unknowns (research.md R1–R9) were resolved.

**Operational SLOs (not CI-gated)**: SC-001 (<1% re-fetch on resume) and SC-002 (multi-session exact-once coverage) are asserted as *mechanisms* in the integration suite against fixtures; the production-scale percentages are observed against live operation via `danni status` and per-run manifests.

**Organization**: Tasks are grouped by user story (US1 = P1 interrupt/resume; US2 = P1 bounded multi-session coverage; US3 = P2 observe + control + retry + degradation) to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Different files, no dependencies on incomplete tasks in the same phase — may run in parallel.
- **[Story]**: User-story phase tasks only (US1, US2, US3). Setup/Foundational/Polish carry no story label.
- Every task includes an exact file path.
- **TDD**: every test task is written and made to FAIL before the implementation task it guards.

## Path Conventions

Single-project layout per plan.md "Project Structure":
- Source: `src/{crawler,store/repos,cli,manifest,lib}/`
- Tests: `tests/{unit,integration,fixtures/{portal,resources,egov}}/`
- Migrations: `migrations/NNN_*.sql`
- Runtime store (gitignored): `store/{raw,manifest}/`, `store/danni.sqlite`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the migration number, gate on 003's duplicate-prefix guard, and stage the recorded egov fixtures every later phase needs. No production behavior change.

- [x] T200 [P] Re-confirm the next free migration prefix by running `ls migrations/` (today: `001_core.sql`, `002_curate_enrich.sql`, `003_index.sql`); per plan.md "Cross-Spec Coordination" the canonical collision-free number for this feature is **006** (002-batch-embedding claims `004_index_failures.sql`, 003-incremental-indexing claims `005_index_state.sql`). Record the chosen number in a one-line note at the top of `migrations/006_crawl_checkpoint.sql` (created in T206) and renumber if a sibling lands first.
- [x] T201 [P] **Duplicate-prefix guard — verification/dependency GATE (NOT a second implementation).** Confirm 003's duplicate-prefix guard is present in `src/store/migrate.ts` (`discoverMigrations` / `runMigrations` throws a `MigrationError` when two files share the same integer `version` prefix) — 003 T002 is the SOLE owner of that guard and its `tests/unit/store/migrate.test.ts` case (plan.md Cross-Spec Coordination). 004 RELIES on it and does NOT re-add it. **Only if 004 lands before 003**: port 003 T002's guard + its `migrate.test.ts` case into this branch as a temporary measure, with a note to drop the duplicate when 003 merges, so the `006`-vs-`004`/`005` collision still fails loudly at migrate time. To avoid relying on a manual "only if" branch, this GATE hard-fails CI: add an assertion in `tests/unit/store/migrate.test.ts` (or `constitution-gates.test.ts`) that `discoverMigrations`/`runMigrations` throws `MigrationError` on two files sharing an integer prefix — so the build is RED whenever the guard is absent, whether or not 003 has merged. At merge time ensure exactly ONE of (003 T002, this fallback) owns the guard to avoid a duplicate definition.
- [x] T202 [P] Capture recorded egov fixtures for resume tests under `tests/fixtures/egov/` — a multi-dataset `listDatasets` paged set (≥2 pages so cursor advance is exercised), `getDatasetDetails` payloads with and without `updated_at`/`version` (to drive both validator branches of T208), `listResources` with multiple resources per dataset, and `getResourceData` tabular (array-of-arrays) + structured (single JSON object) bodies. Include a way to bump one dataset's `updated_at`/`version` between sessions (for the T215 content-changed re-fetch case). Document the recording procedure in `tests/fixtures/egov/README.md`. These replay through `EgovBgClient` (no live network — Constitution VI).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The durable checkpoint schema + the persistence/primitive modules every user story builds on. NO user story may start until this phase is complete.

**⚠️ CRITICAL**: This phase contains the migration and the checkpoint repo — all three stories depend on them.

### Foundational tests (TDD — write FIRST, ensure they FAIL before T206–T209)

> **NOTE**: Per Constitution VIII these are written before the implementation tasks below and MUST fail first.

- [x] T203 [P] [Foundational test] Write FAILING unit tests for scope-hash in `tests/unit/scope-hash.test.ts` BEFORE T207 lands: empty scope → "all" sentinel hash; case-insensitivity (`{publishers:["A","a"]}` === `{publishers:["a"]}`); order-insensitivity; a scope change yields a different hash; ids/slugs lowercased but the function never touches Cyrillic title fields (Constitution X). 100% line + branch (guards T207).
- [x] T204 [P] [Foundational test] Write FAILING unit tests for the validator in `tests/unit/egov-validator.test.ts` BEFORE T208 lands: `updated_at` present → stable hash; `version` change flips the hash even when `updated_at` is equal; both null → content-hash fallback is deterministic and Cyrillic-byte-exact. 100% line + branch (guards T208).
- [x] T205 [Foundational test] Write FAILING unit tests for the repo in `tests/unit/crawl-checkpoints-repo.test.ts` BEFORE T209 lands, against a migrated temp DB: create campaign (assert `max_attempts` defaults to the **fixed cap of 3** — FR-009 — when `createCampaign` is called without an override); append-only frozen-id reconcile preserves order; cursor advance; per-resource success/failed with attempt increment; per-dataset `complete` transition; a row becomes capped at exactly `attempts == max_attempts` (== 3) and a sub-cap failed row is NOT excluded; `counts()`/`remaining()` exclude capped failures; CASCADE delete of a campaign drops its children; `CheckpointCorruptError` thrown on malformed `frozen_ids_json` (FR-008 boundary). 100% line + branch. The temp DB is migrated by `006_crawl_checkpoint.sql` (authored in T206), so this test fails until T206 + T209 land (guards T209).

### Migration (Foundational)

- [x] T206 Author migration `migrations/006_crawl_checkpoint.sql` per data-model.md §2 — create `crawl_checkpoints` (PK `scope_hash`; columns `scope_json`, `frozen_ids_json` DEFAULT '[]', `cursor_uri`, `total_datasets`, `max_attempts` DEFAULT 3 CHECK ≥1 (the **fixed internal cap of 3** per FR-009 — no CLI flag/config sets it; the column is reserved for future configurability), `status` CHECK IN ('active','completed'), `created_at`, `updated_at`, `last_run_id`, `reconciled_at`) + index `idx_crawl_checkpoints_status`; `crawl_checkpoint_datasets` (PK `(scope_hash, dataset_uri)`; `validator`, `outcome` CHECK IN ('pending','complete','failed'), `attempts`, `resource_count`, `captured_count`, `failed_count`, `first_seen_at`, `last_visited_at`, `last_failure_reason`; FK `scope_hash` → `crawl_checkpoints` ON DELETE CASCADE) + index `idx_ccp_datasets_outcome` on `(scope_hash, outcome)`; `crawl_checkpoint_resources` (PK `(scope_hash, dataset_uri, resource_uri)`; `outcome` CHECK IN ('pending','success','failed'), `attempts`, `sha256`, `validator`, `captured_at`, `last_failure_reason`; composite FK `(scope_hash, dataset_uri)` → `crawl_checkpoint_datasets` ON DELETE CASCADE). Additive only — no ALTER/DROP on existing tables. Reuses the existing `datasets.source_etag_or_hash` column (no migration needed for it; data-model.md §1 note). (Guards T205.)

### Scope-hash + validator primitives (Foundational)

- [x] T207 [P] Implement `computeScopeHash(scope: ScopeConfig)` in `src/crawler/scope-hash.ts` (FR-003a, research.md R1): take the four arrays from `ScopeConfigSchema` (`src/config/schema.ts:92` — `publishers`, `categories`, `tags`, `datasetIds`), for each map → lowercase + trim + dedupe (Set) + sort ascending; if all four normalize empty, canonical object is the fixed sentinel `{ "all": true }`, else `{ publishers, categories, tags, datasetIds }` in that fixed key order; return `sha256Hex(JSON.stringify(canonical))` using `src/lib/hash.ts`. Also export the normalized canonical object (persisted as `scope_json`). (Guards T203.)
- [x] T208 [P] Implement `datasetValidator(details)` in `src/crawler/egov-validator.ts` (FR-002, research.md R3): from a `DatasetDetailsResponseSchema` payload (`src/crawler/egov-bg-schema.ts:38` — `data.updated_at`, `data.version`, both `.nullish()`), derive a stable `source_etag_or_hash`: prefer `updated_at`, fold in `version` when present; fall back to `sha256Hex` of a canonical JSON of the consumed metadata (`name`, `descript`, `org_id`, `tags`, `updated_at`, `version`) when both are null. Pure function, no I/O. (Guards T204.)

### Checkpoint repository (Foundational)

- [x] T209 Implement the checkpoint repo in `src/store/repos/crawl-checkpoints.ts` (data-model.md §1, §3) — `CrawlCheckpointsRepo` over the three tables with: `getCampaign(scopeHash)`, `createCampaign({scopeHash, scopeJson, frozenIds, maxAttempts, ...})`, `appendFrozenIds(scopeHash, newUris)` (reconcile, never reorder — data-model §1.1 invariant), `advanceCursor(scopeHash, cursorUri, runId)`, `markCampaignCompleted(scopeHash)`, `upsertDataset`/`markDatasetComplete`/`markDatasetFailed` (attempt++), `upsertResource`/`markResourceSuccess({...sha256, validator, capturedAt})`/`markResourceFailed` (attempt++), and progress queries `counts(scopeHash)` (discovered/captured/failed) + `remaining(scopeHash)` (in-scope datasets not `complete`, EXCLUDING capped failures where `attempts >= max_attempts` — the fixed cap of 3 per FR-009; `createCampaign` takes no `maxAttempts` argument that any caller overrides in this feature, but the parameter is accepted so the reserved column can later be set). Validate `frozen_ids_json` (`z.array(z.string().min(1))`) and `scope_json` (canonical-scope schema or `{all:true}`) on read; a validation failure surfaces a typed `CheckpointCorruptError` to drive the FR-008 degradation (data-model §4). Register the repo in `src/store/repos/index.ts`. Depends on T206. (Guards T205.)

**Checkpoint**: `bun run db:migrate` applies `006_crawl_checkpoint.sql` on a clean checkout; `bun test tests/unit/{scope-hash,egov-validator,crawl-checkpoints-repo}.test.ts` is green with 100% line + branch over `src/crawler/{scope-hash,egov-validator}.ts` and `src/store/repos/crawl-checkpoints.ts`. User-story implementation may now begin.

---

## Phase 3: User Story 1 — Resume an interrupted full crawl without redoing work (Priority: P1) 🎯 MVP

**Goal**: An interrupted crawl resumes from the last committed checkpoint — it skips datasets/resources already captured and unchanged, captures only the rest, and never re-fetches captured-unchanged content (SC-001, <1% re-fetch). A mid-resource interruption loses at most one in-flight resource (SC-004), and the on-disk corpus stays mutually consistent with the checkpoint (SC-003) because capture is atomic and recorded only after rename. This story also lands the FR-007 refactor of `runEgovSync` into `beginSyncRun` (sharing the single lock) and the FR-005 atomic-capture swap, because resume correctness depends on both.

**Independent Test**: Begin a crawl over the fixture catalog, abort it after M of N datasets are captured (inject an error after the M-th dataset's events), re-invoke against the same temp SQLite + temp store root, and assert: zero capture requests for already-captured-and-unchanged resources, the crawl continues from dataset M+1, the final corpus is byte-identical to an uninterrupted crawl, and no `crawl_checkpoint_resources` row is `success` without its bytes present on disk.

### Tests for User Story 1 (TDD — write FIRST, ensure they FAIL) ⚠️

- [x] T210 [P] [US1] Write FAILING unit tests for the planner in `tests/unit/crawl-checkpoint-planner.test.ts` BEFORE T220-T223 land: campaign build sorts by uri and freezes once; `datasetIds` scope bypasses discovery; resume yields units strictly after the cursor; skip decision requires validator-unchanged AND all-resources-success; a validator change re-opens the dataset; reconcile appends (never reorders) and handles a vanished uri. 100% line + branch (guards T220–T223).
- [x] T211 [P] [US1] Write FAILING unit tests for the orchestrator + atomic capture in `tests/unit/run-egov-sync.test.ts` BEFORE T216/T218 land: `runEgovSyncRun` acquires the lock via `beginSyncRun`, records per-dataset/per-resource events, finalizes via `handle.end`, dispatches the notifier on `failed`; capture writes via `atomicWriteFile` and records the checkpoint `success` row ONLY after the rename (assert a write that throws before rename leaves no `success` row and no partial file at the final path). 100% line + branch (guards T216, T218).
- [x] T212 [US1] Integration test: interrupt → resume in `tests/integration/egov-resume.test.ts` against the T202 fixtures (write FIRST, before T223) — fresh run captures N datasets' resources; abort after M datasets (inject an error after the M-th dataset's `captured` events); re-invoke and assert (a) zero `getResourceData` calls for already-captured-and-unchanged resources (SC-001, <1% re-fetch), (b) the crawl continues from dataset M+1, (c) the final corpus byte-equals an uninterrupted run, (d) at most one in-flight resource re-fetched (SC-004), (e) a clean post-completion re-invoke does zero captures and reports up-to-date (SC-005) (guards T223).
- [x] T213 [US1] Integration test: atomic-capture consistency in `tests/integration/egov-edge-cases.test.ts` (atomic-capture case) (write FIRST, before T218) — simulate a crash mid-write (throw inside the write before rename) and assert no `crawl_checkpoint_resources` row is `success` without its bytes present and no truncated file exists at the final `store/raw/<dataset_uri>/<resource_uri>/raw.<ext>` path (FR-005, SC-003) (guards T218).
- [x] T214 [US1] Integration test: mutual exclusion in `tests/integration/egov-edge-cases.test.ts` (lock case) (write FIRST, before T216) — start an egov run holding the single `sync_runs_lock`, attempt a second egov run AND a CKAN run while held, assert both are rejected with `LockContentionError` → exit 5 (egov & CKAN mutually exclusive — FR-007, 001 FR-017c); after the first ends, a subsequent run acquires the lock; an abandoned egov run is reaped (`reapAbandonedRuns`, `sync-run.ts:49`) so the lock never wedges the next session (guards T216).
- [x] T215 [US1] Integration test: content-changed-upstream re-fetch in `tests/integration/egov-edge-cases.test.ts` under a `describe('validator-change re-fetch (US1)')` block — **distinct from T232's `describe('id-set add/remove (US3)')`** so the two edits to this file do not overlap: T215 flips the validator on an EXISTING dataset (id set unchanged); T232 changes the id-set MEMBERSHIP (add/remove) (write FIRST, before T223) — run a full session over the T202 fixtures so every dataset is captured; between sessions bump exactly ONE dataset's `updated_at`/`version` in the egov fixture (flipping its validator per T208) while leaving all others unchanged; re-invoke and assert (a) the bumped dataset's `getDatasetDetails` is re-fetched, its validator is re-written into `datasets.source_etag_or_hash` + the checkpoint dataset row, and exactly that dataset's resources are re-fetched (its `getResourceData` is called), and (b) every UNCHANGED dataset issues ZERO `getResourceData` calls on resume (FR-002, SC-001 selective re-fetch) (guards T221, T223).

### Refactor egov into the Sync Run machinery + atomic capture (US1 — FR-007, FR-005)

- [x] T216 [US1] Introduce the egov orchestrator `runEgovSyncRun` in `src/crawler/run-egov-sync.ts` mirroring `runSync` (`src/crawler/run-sync.ts:45`): call `beginSyncRun({ db, storeRoot, trigger, scopeFilter, onOverlap })` (`src/manifest/sync-run.ts:57`) to acquire the single `sync_runs_lock`, build/load the campaign (Phase 2 repo), drive `runEgovSync` with the returned `SyncRunHandle`, then `handle.end({ summaryOutcome, totals, datasetEntries })` (or `handle.abort(reason)` on error) and dispatch the notifier on `failed`/threshold exactly as `run-sync.ts:230-256` (`dispatchAndPersist`, `failureRate`). Re-throw `LockContentionError` to the caller. Depends on T209. (Guards T211, T214.)
- [x] T217 [US1] Refactor `runEgovSync` in `src/crawler/egov-sync.ts` to accept a `SyncRunHandle` (instead of running outside it): record `handle.recordEvent(...)` per dataset (`discovered` / `skipped_unchanged`) and per resource (`captured` / `skipped_unchanged` / `failed`) using the existing `EventOutcome` set (`src/store/repos/sync-run-events.ts:4` — no schema change; data-model §1 confirms all outcomes already exist), and accumulate `ManifestTotals` + `ManifestDatasetEntry[]` for `handle.end`. Keep the discovery/capture logic intact for now (resume plan wired in T223). Depends on T216.
- [x] T218 [US1] Replace the non-atomic write at `src/crawler/egov-sync.ts:287` (`writeFileSync(join(opts.storeRoot, 'raw', rawPath), content)`) with `atomicWriteFile` from `src/lib/fs.ts:8` (temp → fsync → rename), and record the capture (`resourcesRepo.recordCapture` + the checkpoint resource row marked `success` via `markResourceSuccess`) **only after** `atomicWriteFile` returns (FR-005, SC-003, research.md R5). Remove the now-unused `writeFileSync` import. Depends on T209, T217. (Guards T211, T213.)
- [x] T219 [US1] Route the egov branch in `src/cli/sync.ts:124-136` through `runEgovSyncRun` instead of calling `runEgovSync` directly: pass `trigger: 'manual'`, the scope, and a notifier built via `createNotifier({ config: config.schedule.notifier })`; wrap in the same try/catch the CKAN branch uses (`src/cli/sync.ts:155-162`) so `LockContentionError` → exit 5 and other errors → exit 4; map success/partial → 0 and failed → 3. Depends on T216.

### Resume planner + dataset-level validator skip (US1 — FR-001, FR-002, FR-003, FR-004)

- [x] T220 [US1] Implement the campaign builder/loader in `src/crawler/crawl-checkpoint.ts` (FR-003, research.md R2): on campaign start (no `crawl_checkpoints` row for the scope-hash from T207) enumerate the full in-scope dataset-uri set once by paging `EgovBgClient.listDatasets({ recordsPerPage: 100, pageNumber })` (`src/crawler/egov-bg-client.ts:76`) with NO `--max` cap on discovery — exactly the current loop at `egov-sync.ts:191-203` but uncapped — collect `d.uri`, sort by uri, and persist via `createCampaign(frozenIds=...)`. When `scope.datasetIds` is set, the frozen list is those uris sorted (no discovery paging — mirrors the `opts.datasetUris` branch at `egov-sync.ts:188`). On resume, load the existing row; the cursor is `cursor_uri`. (Guards T210.)
- [x] T221 [US1] Implement the per-unit resume planner in `src/crawler/crawl-checkpoint.ts` (FR-002, research.md R3): given a dataset uri and its freshly fetched `getDatasetDetails`, compute the validator (T208) and decide **skip** (stored validator unchanged AND every `crawl_checkpoint_resources` row for it is `success`) vs **fetch**; within a fetched dataset, skip resources already `success` under the **current** validator and (re)capture only changed/missing ones. Produce an ordered plan over `frozen_ids` strictly after `cursor_uri`. Depends on T208, T209, T220. (Guards T210, T215.)
- [x] T222 [US1] Implement catalog reconciliation in `src/crawler/crawl-checkpoint.ts` (FR-004, research.md R2): after the frozen list is exhausted (or on an explicit reconcile pass), re-enumerate and diff — append new uris to `frozen_ids` (via `appendFrozenIds`, never reorder), set `reconciled_at`, and route vanished uris through the existing withdrawal handling. Because the cursor advances over the stable sorted uri order, page reordering between sessions never skips a dataset. Depends on T220. (Guards T210.)
- [x] T223 [US1] Wire `runEgovSync` (`src/crawler/egov-sync.ts`) to consume the resume plan from T221: skip captured-unchanged datasets/resources (recording `skipped_unchanged` events), capture the rest atomically (T218), write the dataset-level validator into `datasets.source_etag_or_hash` and the checkpoint dataset row, and after **each dataset** fully completes call `advanceCursor(scopeHash, uri, runId)`; after **each resource** completes, `markResourceSuccess` / `markResourceFailed` (so an interruption loses ≤1 in-flight resource — SC-004, research.md R6). Depends on T217, T218, T221. (Guards T210, T212, T215.)

**Checkpoint**: `bun run danni sync --max <n>` (egov path) runs inside a `sync_runs` row + manifest, captures atomically, and resumes after an interruption with <1% re-fetch; US1 acceptance scenarios 1-3 pass; coverage gate green over US1 modules. **MVP shippable here.**

---

## Phase 4: User Story 2 — Run a full crawl in bounded batches across sessions (Priority: P1)

**Goal**: `--max` is the per-session **dataset** batch; each session advances and persists the cursor so repeated bounded sessions cover the catalog exactly once with no gaps or duplicates, and the union equals a single uncapped crawl (SC-002). When the cursor passes the last frozen id, the campaign flips to `completed` and further sessions make no discovery requests.

**Independent Test**: Run the crawl over the fixture catalog in several `--max`-capped sessions and assert every in-scope dataset is visited exactly once (PK on `crawl_checkpoint_datasets` plus a per-uri visit assertion — no gaps, no duplicates), the union corpus equals one uncapped crawl, and an extra session after `completed` issues no `listDatasets` call.

### Tests for User Story 2 (TDD — write FIRST, ensure they FAIL) ⚠️

- [x] T224 [P] [US2] Write FAILING unit tests for the `--max` batch + completion logic in `tests/unit/crawl-checkpoint-planner.test.ts` (extend) BEFORE T226/T227 land: a session yields exactly `max` units after the cursor; the cursor persists at the last completed uri; reaching the end flips status to `completed`; a `completed` campaign yields an empty plan and triggers no discovery. 100% line + branch (guards T226, T227).
- [x] T225 [US2] Integration test: bounded multi-session coverage in `tests/integration/egov-bounded-sessions.test.ts` against the T202 multi-page fixtures (write FIRST, before T227) — run with `--max` smaller than the catalog across several sessions; assert (a) each session advances `cursor_uri` and processes ≤ `max` datasets, (b) across sessions every dataset is visited exactly once (no gaps/dupes), (c) the union corpus byte-equals a single uncapped run (SC-002), (d) once `status='completed'` an extra session makes no `listDatasets` discovery call and zero captures (SC-005, acceptance scenario 2) (guards T227).

### Implementation for User Story 2

- [x] T226 [US2] Honor `--max` as a per-session **dataset** batch in `runEgovSync` (`src/crawler/egov-sync.ts`) + `runEgovSyncRun` (`src/crawler/run-egov-sync.ts`) (FR-003, research.md R6): process at most `flags.max` datasets from the frozen list strictly after `cursor_uri` (discovery already enumerates the full set once in T220 — `--max` bounds the session, not discovery). The existing `--max` parse in `src/cli/sync.ts:67-71` is reused unchanged (positive-int validated). Depends on T223. (Guards T224.)
- [x] T227 [US2] Implement campaign completion in `src/crawler/crawl-checkpoint.ts` + `runEgovSync`: when the cursor advances past the last frozen id with no retry-eligible failures, call `markCampaignCompleted(scopeHash)` (status `active`→`completed`, data-model §3.3); a session over a `completed` campaign short-circuits discovery and capture and reports the corpus up to date (SC-005). Depends on T223, T226. (Guards T224, T225.)

**Checkpoint**: A multi-session `danni sync --max <n>` run covers the fixture catalog exactly once and converges to `completed`; US2 acceptance scenarios pass; coverage gate green over US2 additions.

---

## Phase 5: User Story 3 — Observe and control crawl progress (Priority: P2)

**Goal**: The operator can see progress (discovered / captured / failed / remaining) and stop safely at any time, knowing the next run resumes cleanly. Recorded failures are skipped on a normal resume (cursor advances) and re-attempted only with `--retry-failed`, capped by `max_attempts`; `remaining` excludes capped failures (FR-009). A lost/corrupt checkpoint degrades to a safe re-scan that reuses on-disk content (FR-008).

**Independent Test**: During a crawl, query status and read discovered/captured/failed/remaining; stop the crawl and verify the persisted checkpoint reflects the last completed unit and that resuming continues from it. Force a persistently-failing resource and verify it is recorded `failed`, the cursor advances, it is excluded from `remaining` once capped, and `--retry-failed` re-attempts it up to the cap. Delete the checkpoint row and verify a safe re-scan that re-downloads nothing already present and unchanged.

### Tests for User Story 3 (TDD — write FIRST, ensure they FAIL) ⚠️

- [x] T228 [P] [US3] Write FAILING unit tests for the retry/remaining accounting in `tests/unit/crawl-checkpoints-repo.test.ts` (extend) + `tests/unit/crawl-checkpoint-planner.test.ts` (extend) BEFORE T233-T235 land: a failure increments `attempts`; a normal resume skips failures (not in the plan); `--retry-failed` re-opens only sub-cap failures; capped failures are excluded from `remaining()`; the degradation path is selected on missing/corrupt rows. 100% line + branch (guards T233–T235).
- [x] T229 [US3] Integration test: progress + safe stop in `tests/integration/egov-status-stop.test.ts` (write FIRST, before T233) — run a partial crawl, assert `danni status --json` reports discovered/captured/failed/remaining for the campaign (FR-006); stop after a dataset boundary and assert `cursor_uri` reflects the last completed unit and a resume continues from it with no lost or duplicated work (US3 acceptance scenarios 1-2) (guards T233).
- [x] T230 [US3] Integration test: capped failure + `--retry-failed` in `tests/integration/egov-edge-cases.test.ts` (failure case) (write FIRST, before T234) — inject a persistently-failing `getResourceData` for one resource; assert it is recorded `failed` with `attempts++`, the cursor advances past it (does not block progression), it is excluded from `remaining` once `attempts == max_attempts`, a normal resume skips it, and `--retry-failed` re-attempts it up to the cap but not beyond (FR-009, edge case "MUST not block forever") (guards T234).
- [x] T231 [US3] Integration test: lost-checkpoint degradation in `tests/integration/egov-edge-cases.test.ts` (degradation case) (write FIRST, before T235) — after a completed campaign, `DELETE FROM crawl_checkpoints` (cascades children), then re-invoke; assert the crawl re-scans, rebuilds the checkpoint, and re-downloads nothing already present and unchanged on disk (FR-008, SC-003); repeat with a deliberately corrupted `frozen_ids_json` to exercise the `CheckpointCorruptError` branch (guards T235).
- [x] T232 [US3] Integration test: catalog-change reconciliation in `tests/integration/egov-edge-cases.test.ts` under a `describe('id-set add/remove (US3)')` block — **distinct from T215's `describe('validator-change re-fetch (US1)')`** (T232 changes id-set MEMBERSHIP; T215 only flips a validator on an unchanged id set) so the US1 and US3 edits to this shared file do not produce redundant assertions or coverage gaps — between sessions add a new dataset uri and remove another from the `listDatasets` fixture; assert the new uri is eventually visited (appended to `frozen_ids`, processed on a reconcile pass), the removed uri is handled per the withdrawal path, and no in-scope dataset is silently skipped because of reordering (FR-004, edge case). This is a US3 end-to-end edge-case exercise of US1's reconciliation (T222); T222's write-first TDD guard is the US1 unit test T210 (reconcile appends / vanished-uri). Depends on T222.

### Implementation for User Story 3

- [x] T233 [US3] Surface campaign progress (discovered / captured / failed / remaining) in `danni status` via `src/cli/status.ts`: when an active `crawl_checkpoints` row exists, join the checkpoint `counts()`/`remaining()` (T209) into the status output (human + `--json`) alongside the existing `sync_runs` view; `remaining` excludes capped failures (FR-009, FR-006). Reuse the existing `SyncRunsRepo`/lock surface already wired in `status.ts`. Depends on T209. (Guards T228, T229.)
- [x] T234 [US3] Add the `--retry-failed` flag to `src/cli/sync.ts` (`SyncFlags.retryFailed: boolean`, parsed in `parseFlags`, documented in the `--help` text alongside the clarified `--max` semantics) and thread it through `runEgovSyncRun` → `runEgovSync`. A normal resume skips recorded failures (cursor advances past them); `--retry-failed` re-opens rows with `outcome='failed'` AND `attempts < max_attempts` back to `pending` for re-attempt; rows at the cap (`attempts >= max_attempts`, the fixed cap of 3) are NOT retried (FR-009, research.md R7). `--retry-failed` is a boolean ONLY — it does NOT change `max_attempts` (no flag/config exposes the cap in this feature; the column stays its default 3). Depends on T219, T223. (Guards T228, T230.)
- [x] T235 [US3] Implement the lost/corrupt-checkpoint degradation in `src/crawler/crawl-checkpoint.ts` (FR-008, research.md R8): when `getCampaign` returns no row, or the repo throws `CheckpointCorruptError` (T209), log a structured warning and fall back to a full re-scan for that scope-hash — re-enumerate the in-scope id set and re-process, but before recording any capture compare the freshly serialized payload's `sha256Hex` (`src/lib/hash.ts`) against the on-disk file so already-present-and-unchanged resources are not re-downloaded (mirrors `BlobStore.put` reuse-on-match, `src/store/blob-store.ts`); then write a fresh checkpoint row so the next session resumes normally. Depends on T209, T220. (Guards T228, T231.)

**Checkpoint**: `danni status` reports campaign progress; stop/resume is safe; failures are capped and retryable only via `--retry-failed`; a lost checkpoint degrades to a safe re-scan; all US3 acceptance scenarios + edge cases pass; coverage gate green over US3 modules.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Docs, help text, and the final gates spanning all stories.

- [x] T236 [P] Validate `specs/004-crawl-checkpoint-resume/quickstart.md` end-to-end against the implemented CLI in `tests/integration/quickstart-004.test.ts`: every path-like reference resolves, the documented `sqlite3` checkpoint queries (§1, §2, §5) match the shipped schema, the §5 `remaining` cross-check query yields the SAME number as `danni status`'s shipped `remaining()` (T209/T233) — including when a sub-cap `failed` row is present (still counted) and a capped one is present (excluded) — and the §7 mutual-exclusion exit-code-5 example holds.
- [x] T237 [P] Update `danni sync --help` in `src/cli/sync.ts` to document `--retry-failed` and clarify that `--max` is the per-session **dataset** batch that advances and persists the cursor (quickstart.md §1, §6; research.md R6).
- [x] T238 [P] Confirm parity matrix is unaffected (`tests/parity-matrix.json`): this feature consumes no NEW portal endpoint (reuses `EgovBgClient.listDatasets`/`getDatasetDetails`/`listResources`/`getResourceData`/`listOrganisations` already covered). Make this a concrete pass/fail rather than a manual judgment — add an assertion in `tests/integration/constitution-gates.test.ts` that the set of public egov methods on `EgovBgClient` (`src/crawler/egov-bg-client.ts`) is exactly the parity-covered set, so if a future edit introduces a new egov method the gate FAILS and forces a parity-matrix update (Constitution VIII endpoint parity). Expected today: green, with no parity-matrix change.
- [x] T239 Final coverage audit: `bun test --coverage` reports 100% line + branch over every authored module for this feature — `src/crawler/{scope-hash,egov-validator,crawl-checkpoint,run-egov-sync}.ts`, the refactored `src/crawler/egov-sync.ts`, `src/store/repos/crawl-checkpoints.ts`, and the `src/cli/{sync,status}.ts` deltas — and the unit suite stays within the <5s budget (Constitution VI, VIII). The per-resource checkpoint commit is a single small `UPDATE` (plan.md Performance Goals).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** → T200, T201, T202 all parallel; no dependencies. T201 is a verification GATE on 003's guard (not a re-implementation).
- **Phase 2 (Foundational)** → tests T203/T204/T205 are written FIRST and FAIL; then impl: T206 (migration) blocks T209; T207/T208 (pure primitives) implement what T203/T204 guard; T209 (repo) depends on T206. T205 needs T206 authored so its temp DB migrates. **Blocks all user stories.**
- **Phase 3 (US1)** → starts after Phase 2. Tests T210–T215 are written FIRST and FAIL, BEFORE the impl they guard. Impl: T216→T217→T218 (orchestrator → handle refactor → atomic capture); T219 depends on T216; T220→T221→T222→T223 (campaign → planner → reconcile → wire).
- **Phase 4 (US2)** → starts after US1 (extends the same `runEgovSync` loop + cursor). Tests T224/T225 first; impl T226→T227.
- **Phase 5 (US3)** → starts after US1 (status + retry + degradation build on the planner/repo). Tests T228–T232 first; impl T233, T234, T235 (different files/branches).
- **Phase 6 (Polish)** → after the stories in the cut are complete.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. Lands the FR-007 + FR-005 refactor it needs; independently testable via `tests/integration/egov-resume.test.ts`.
- **US2 (P1)**: Builds on US1's cursor/loop (the `--max` batch advances the same persisted cursor). Independently testable via `tests/integration/egov-bounded-sessions.test.ts`.
- **US3 (P2)**: Builds on US1's planner/repo (status reads counts; retry re-opens failures; degradation re-scans). Independently testable via `tests/integration/egov-status-stop.test.ts` + edge-case file.

### Within Each User Story

- Tests are written FIRST and MUST FAIL before the implementation they guard (Constitution VII TDD; tests-template "Write these tests FIRST, ensure they FAIL").
- Tests → migration → repo → planner/orchestrator → CLI wiring → integration tests of those commands.

### Parallel Opportunities

- **Phase 1**: T200, T201, T202 in parallel.
- **Phase 2**: tests T203 (scope-hash) ∥ T204 (validator) ∥ T205 (repo); then impl T207 (scope-hash) ∥ T208 (validator); T209 (repo) after T206.
- **US1**: T210 and T211 (unit tests) in parallel; the integration tests T212–T215 share `egov-edge-cases.test.ts`/`egov-resume.test.ts` (distinct `describe` blocks). The two impl chains T216→T219 and T220→T223 are largely independent until T223 merges them.
- **US2**: T224 (unit test) in parallel with the other unit work; impl T226→T227 sequential.
- **US3**: T228 (unit test) parallel; impl T233, T234, T235 touch different surfaces (status / cli flag / planner) and can proceed in parallel.
- **Polish**: T236, T237, T238 in parallel; T239 last.

---

## Parallel Example: Phase 2 (Foundational tests then primitives)

```bash
# Write the FAILING tests first (TDD), in parallel:
Task: "T203 FAILING unit tests in tests/unit/scope-hash.test.ts"
Task: "T204 FAILING unit tests in tests/unit/egov-validator.test.ts"
Task: "T205 FAILING repo unit tests in tests/unit/crawl-checkpoints-repo.test.ts"

# Then author the migration and implement the primitives:
Task: "T206 Author migration migrations/006_crawl_checkpoint.sql"
Task: "T207 Implement computeScopeHash in src/crawler/scope-hash.ts"
Task: "T208 Implement datasetValidator in src/crawler/egov-validator.ts"
Task: "T209 Implement CrawlCheckpointsRepo in src/store/repos/crawl-checkpoints.ts"
```

## Parallel Example: User Story 1 — tests

```bash
# Before the US1 impl chain lands, the unit tests fan out (write FIRST, must FAIL):
Task: "T210 [US1] Planner unit tests in tests/unit/crawl-checkpoint-planner.test.ts"
Task: "T211 [US1] Orchestrator + atomic-capture unit tests in tests/unit/run-egov-sync.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (Setup) → 2. Phase 2 (Foundational) → 3. Phase 3 (US1).
2. **Stop and validate**: run `danni sync --max <n>` (egov), interrupt it, resume; assert <1% re-fetch, atomic capture, mutual exclusion with CKAN; coverage 100% over US1 modules.
3. This is shippable: an interrupted full crawl now resumes instead of starting over, and the egov path is audited + lock-safe (closing the 001 FR-017c gap).

### Incremental Delivery

1. MVP (US1) → demo/deploy: resumable, atomic, audited egov crawl.
2. Add US2 (bounded sessions) → multi-session exact-once coverage; `--max` batches converge to `completed`.
3. Add US3 (observe + control) → `danni status` progress, `--retry-failed`, lost-checkpoint degradation.
4. Polish (Phase 6) → quickstart validation, help text, coverage audit.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in the same phase.
- [Story] label maps each task to its user story; Setup/Foundational/Polish carry no story label.
- Tests are MANDATORY and TDD (Constitution VII, VIII): write the failing test first, then implement; 100% line + branch coverage enforced by `bun test --coverage`. Tests run with `bun test` against recorded egov fixtures (`tests/fixtures/egov/`) — no live network in the dev loop (Constitution VI).
- Cyrillic preservation (Constitution X): the dataset-uri sort and scope-array normalization (lowercase + dedupe) operate on ASCII ids/slugs only — never on authoritative Cyrillic title/description fields; captured bytes round-trip byte-exact (asserted in T204, T212).
- Migration numbering: this feature ships `006_crawl_checkpoint.sql` per plan.md "Cross-Spec Coordination"; T200 re-confirms the next free prefix at merge time and T201 GATES on 003 T002's duplicate-prefix guard (it does not re-implement it) so a collision fails loudly.
- Commit after each task or logical group; stop at any phase checkpoint to run `bun test --coverage` and validate the constitution gates before proceeding.
</content>
</invoke>
