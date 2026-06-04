# Feature Specification: Crawl Checkpoint & Resume for Full-Portal Sync

**Feature Branch**: `004-crawl-checkpoint-resume`  
**Created**: 2026-06-03  
**Status**: Implemented (shipped in 081b2dc; verified by the test suite, 2026-06-04)  
**Input**: User description: "Crawling the whole data.egov.bg portal is ~12k datasets and tens of thousands of requests at a respectful rate — a long run. Make a full sync resumable: checkpoint progress so an interrupted crawl continues without re-fetching what it already captured, and let it run in batches across sessions."

## Clarifications

### Session 2026-06-03

- Q: Where is the crawl checkpoint persisted and at what granularity? → A: A new `crawl_checkpoint` table keyed by scope-hash holding the discovery cursor + counts, with explicit per-dataset **and per-resource** completion rows — so resume can skip already-captured resources within an in-flight dataset.
- Q: What is the discovery cursor's type? → A: A stable dataset-id high-water-mark — enumerate the in-scope id set once per campaign, store a sorted dataset-id watermark, and advance by id (not page number); added/removed ids are reconciled on a later pass.
- Q: How is "already captured & unchanged" decided for an egov datastore resource (no HTTP ETag/Last-Modified)? → A: Skip at the dataset level when the dataset's `metadata_modified` / `source_etag_or_hash` is unchanged AND all its resources have a prior successful capture; the egov datastore lacks per-resource HTTP validators, so "no fetch" relies on the dataset-level validator.
- Q: Should the egov crawl reuse the existing Sync Run machinery? → A: Yes — egov-sync runs inside `beginSyncRun` (lock, `sync_runs` record, `sync_run_events`, manifest, notifier) and adds only the checkpoint cursor; this satisfies 001's FR-017a/FR-017c.
- Q: What does `--max` mean and at what granularity does resume happen? → A: `--max` is the per-session **dataset** batch that advances and persists the cursor; completion is recorded **per resource**, so a mid-dataset interruption re-fetches at most the single in-flight resource on resume.

### Session 2026-06-03 (round 2)

- Q: How is the in-scope dataset-id set materialized/ordered given page-only pagination? → A: Enumerate the full in-scope id set once at campaign start, sort by dataset uri, and persist the frozen sorted list in the checkpoint; the cursor is the last completed uri, so resume is gap-free regardless of page order.
- Q: Scope-hash fields/normalization, and mid-campaign change? → A: SHA-256 over a canonical JSON of all four scope arrays (publishers, categories, tags, datasetIds), each sorted + deduped + lowercased, with empty scope hashing to a fixed "all" sentinel; a scope change starts a fresh checkpoint row (the old one is retained).
- Q: Does egov-sync move inside `beginSyncRun`, sharing the lock? → A: Yes — `runEgovSync` is refactored to run inside `beginSyncRun`, sharing the single `sync_runs_lock` / `sync_runs` / `sync_run_events` / manifest / notifier with the CKAN path; egov and CKAN runs are mutually exclusive under that one lock.
- Q: How is egov resource capture made atomic? → A: Write to a temp path, fsync, atomic-rename into place, and record the capture only after the rename succeeds (mirroring the CKAN download path); the non-atomic `writeFileSync` is replaced.
- Q: Retry policy for previously-failed units? → A: A normal resume skips recorded failures (the cursor advances); they are re-attempted only with an explicit `--retry-failed` flag, capped by a per-row max-attempts count; "remaining" excludes capped failures.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Resume an interrupted full crawl without redoing work (Priority: P1)

An operator starts a full-portal crawl. It is interrupted partway through (machine sleeps, network drops, the operator stops it). On the next invocation, the crawl resumes from where it left off — it skips datasets and resources already captured and unchanged, and continues with the rest — instead of starting over.

**Why this priority**: A full crawl is long-running; without resume, any interruption wastes hours of respectful, rate-limited fetching and may never complete. Resumability is what makes a full-portal crawl feasible at all.

**Independent Test**: Begin a crawl scoped to many datasets, interrupt it after some are captured, then re-invoke. Verify that already-captured resources are not re-fetched (no portal requests for them), that the crawl continues from the next uncaptured dataset, and that the final result is identical to an uninterrupted crawl.

**Acceptance Scenarios**:

1. **Given** a crawl interrupted after capturing the first M of N datasets, **When** it is re-invoked, **Then** it issues no capture requests for the already-captured-and-unchanged resources and completes the remaining N − M datasets.
2. **Given** a crawl that completed fully, **When** it is re-invoked with no upstream changes, **Then** it performs no captures and reports the corpus as already up to date.
3. **Given** an interruption in the middle of capturing a single dataset's resources, **When** the crawl resumes, **Then** no resource is left half-written and each resource is either fully captured or cleanly retried.

---

### User Story 2 - Run a full crawl in bounded batches across sessions (Priority: P1)

An operator deliberately crawls the portal in chunks (e.g., a few hundred datasets per session) to spread load over time. Each session advances a durable cursor; the next session continues from that cursor until the whole portal is covered.

**Why this priority**: Operators need to bound each session's duration and load (respect for the source, local time/resource limits). A resumable cursor turns one impractical marathon into a sequence of manageable batches.

**Independent Test**: Run the crawl in several capped sessions and verify that, across sessions, every dataset is visited exactly once (no gaps, no duplicates) and the union equals a single uncapped crawl.

**Acceptance Scenarios**:

1. **Given** a per-session cap, **When** the crawl is run repeatedly, **Then** each session advances the cursor and the sessions together cover every dataset exactly once.
2. **Given** the cursor at the end of the catalog, **When** another session runs, **Then** it reports completion and makes no further discovery requests.

---

### User Story 3 - Observe and control crawl progress (Priority: P2)

The operator can see how far a crawl has progressed (datasets visited / total, captured / failed) and can stop it safely at any time, knowing the next run will resume cleanly.

**Why this priority**: Long runs need visibility and a safe stop, both for operability and to decide when to pause. P2 because correctness of resume (P1) is the foundation; observability makes it usable.

**Independent Test**: During a crawl, inspect the reported progress and stop the crawl; verify the persisted checkpoint reflects the last completed unit and that resuming continues from it.

**Acceptance Scenarios**:

1. **Given** a crawl in progress, **When** the operator queries status, **Then** it reports datasets discovered, captured, failed, and remaining.
2. **Given** the operator stops the crawl, **When** it is resumed, **Then** it continues from the last committed checkpoint with no lost or duplicated work.

---

### Edge Cases

- The catalog changes between sessions (datasets added/removed/reordered) — resume MUST remain correct: newly added datasets are eventually visited, removed ones are handled per the withdrawal rules, and no dataset is silently skipped because of reordering.
- A resource that was captured in a prior session has changed upstream — on resume it MUST be re-fetched (conditional request / content comparison), while unchanged resources are skipped.
- The checkpoint store is lost or corrupted — the crawl MUST be able to fall back to a safe full re-scan that still skips resources already present and unchanged on disk.
- An interruption during a partial resource write — the partial MUST never be recorded as a successful capture; capture MUST be atomic.
- Concurrent or overlapping crawl invocations — MUST be prevented or coordinated so two runs do not advance the same cursor inconsistently.
- A persistently failing dataset/resource — MUST not block forever; it is recorded as failed and the cursor advances, with the failure visible for later retry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A full crawl MUST persist its progress in a durable `crawl_checkpoint` store keyed by scope-hash — the discovery cursor, counts, and per-dataset **and per-resource** completion rows — committed frequently enough that an interruption loses at most one in-flight resource.
- **FR-002**: On resume, the crawl MUST NOT re-fetch resources that were already captured and are unchanged upstream; for the egov datastore path (which has no per-resource HTTP validators) "unchanged" is decided at the dataset level — the dataset's `metadata_modified` / `source_etag_or_hash` is unchanged AND all its resources have a prior successful capture.
- **FR-003**: The crawl MUST enumerate the full in-scope dataset-id set once at campaign start, sort it by dataset uri, and persist that frozen sorted list in the checkpoint; the cursor MUST be the last completed uri (a stable high-water-mark, not a page index). A per-session bound (`--max` count of datasets) MUST advance and persist the cursor so repeated bounded sessions cover the catalog exactly once.
- **FR-003a**: The checkpoint MUST be keyed by a scope-hash = SHA-256 over a canonical JSON of the four scope arrays (publishers, categories, tags, datasetIds), each sorted + deduped + lowercased, with empty scope hashing to a fixed "all" sentinel; a scope change MUST start a fresh checkpoint row while retaining the prior one.
- **FR-004**: Resume MUST be correct under catalog changes between sessions: because the cursor advances over a stable dataset-id ordering, no in-scope dataset is permanently skipped, and additions/removals are reconciled on a subsequent pass.
- **FR-005**: Each resource capture MUST be atomic — written to a temp path, fsync'd, and atomic-renamed into place, with the capture recorded only after the rename succeeds (replacing the non-atomic direct write) — so an interruption never leaves a partial capture marked successful.
- **FR-006**: The crawl MUST expose progress (discovered, captured, failed, remaining) and MUST be safe to stop at any time, with the next run resuming from the last committed checkpoint.
- **FR-007**: `runEgovSync` MUST be refactored to run inside the existing Sync Run machinery (`beginSyncRun`: the `sync_runs_lock`, the `sync_runs` record, `sync_run_events`, manifest, and notifier), sharing the single lock with the CKAN path so egov and CKAN runs are mutually exclusive and two crawls never advance the same cursor/checkpoint inconsistently (001 FR-017c), and reusing its run-history/notifications (001 FR-017a/FR-017b).
- **FR-008**: A lost or unreadable checkpoint MUST degrade to a safe full re-scan that still avoids re-downloading resources already present and unchanged on disk.
- **FR-009**: A persistently failing dataset or resource MUST be recorded as failed (with a per-row attempt count) and MUST NOT block progression; a normal resume MUST skip recorded failures (advancing the cursor), and they MUST be re-attempted only when run with an explicit `--retry-failed` flag, capped by a maximum attempts count. The maximum attempts count is a **fixed internal default of 3** for this feature (no CLI flag or config exposes it); the `crawl_checkpoints.max_attempts` column persists this value per campaign and is **reserved** so the cap can be made operator-configurable in a later feature without a schema change. A row is at the cap when `attempts >= max_attempts`. Progress "remaining" MUST exclude capped failures.

### Key Entities

- **Crawl checkpoint**: Durable `crawl_checkpoint` record keyed by scope-hash — the frozen sorted in-scope dataset-id list, the last-completed-uri cursor, per-dataset and per-resource completion rows with their outcomes and per-row attempt counts, and counts — sufficient to resume correctly after an interruption.
- **Crawl session**: A single bounded invocation of the crawl that advances the checkpoint; multiple sessions compose into full coverage of the catalog.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An interrupted full crawl, when resumed, re-fetches less than 1% of already-captured-and-unchanged resources.
- **SC-002**: A full crawl run across multiple bounded sessions visits every in-scope dataset exactly once, with no gaps or duplicates, and yields the same final corpus as a single uninterrupted crawl.
- **SC-003**: After any interruption, the on-disk corpus and the checkpoint remain mutually consistent — no resource is recorded as captured without its bytes present, and no captured bytes are missing from the record.
- **SC-004**: Resuming a crawl loses at most one in-flight resource of work relative to the last committed checkpoint (per-resource completion granularity).
- **SC-005**: A re-invocation after full completion (no upstream changes) performs zero captures and reports the corpus as up to date.

## Assumptions

- Targets the portal-sync paths (`danni sync`), including the data.egov.bg adapter that captures datastore content per resource; the discovery cursor uses the portal's paginated catalog.
- Reuses the existing capture model (raw bytes on disk, recorded outcomes, conditional re-fetch by content hash / validators) and extends it with durable cross-session progress.
- Strengthens and generalizes the resumability already required by FR-007 of `001-egov-data-sync` to the full-portal, multi-session scale.
- Out of scope: parallelizing the crawl beyond the existing rate-limit/concurrency controls; changing the respectful-crawling (rate-limit, back-off, robots) policy; curation/indexing (run after capture).
