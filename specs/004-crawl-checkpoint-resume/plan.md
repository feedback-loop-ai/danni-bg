# Implementation Plan: Crawl Checkpoint & Resume for Full-Portal Sync

**Branch**: `004-crawl-checkpoint-resume` | **Date**: 2026-06-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-crawl-checkpoint-resume/spec.md`

## Summary

Make a full-portal data.egov.bg crawl resumable across sessions. Today `runEgovSync`
(`src/crawler/egov-sync.ts`) enumerates datasets page-by-page with an in-memory `--max`
cap, writes each resource with a non-atomic `writeFileSync`, and runs **outside** the Sync
Run machinery entirely (the CLI calls it directly — `src/cli/sync.ts:124–136` — bypassing
`beginSyncRun`, the lock, `sync_runs`, events, manifest, and notifier). That means an
interrupted crawl loses all progress and the egov path can race the CKAN path.

This feature adds a durable `crawl_checkpoint` table keyed by a **scope-hash** holding a
**frozen sorted id list** (enumerated once per campaign, sorted by dataset uri) plus
per-dataset and per-resource completion rows with attempt counts. `runEgovSync` is
refactored to run **inside `beginSyncRun`** so it shares the single `sync_runs_lock` with
the CKAN path (egov and CKAN runs become mutually exclusive), reuses `sync_runs` /
`sync_run_events` / manifest / notifier (satisfying 001 FR-017a/FR-017b/FR-017c), and
records progress per resource. `--max` becomes a per-session **dataset** batch that advances
and persists the cursor (last completed uri). Resource capture is made atomic by replacing
the direct write with the existing `atomicWriteFile` primitive (`src/lib/fs.ts`: temp →
fsync → rename), recording the capture only after the rename. Resume skips datasets whose
dataset-level validator (`updated_at`/`version` → `source_etag_or_hash`) is unchanged AND
whose resources all have a prior successful capture, re-fetching at most one in-flight
resource. A lost checkpoint degrades to a safe re-scan (on-disk content reuse via the
content-addressed blob layout). `--retry-failed` re-attempts recorded failures, capped by a
per-row max-attempts count.

No new runtime dependencies. Reuses Bun + TypeScript (strict) + `bun:sqlite` + zod + biome
and the in-house forward-only migration runner (`src/store/migrate.ts`).

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, `noUncheckedIndexedAccess`, no `any` outside type guards) on Bun 1.x.
**Primary Dependencies**:
- Runtime: Bun 1.x (`bun:sqlite`, built-in `fetch`); `bun test --coverage` (see 001 Complexity Tracking — Vitest hangs under Bun with `bun:sqlite`).
- Validation: Zod ^3.25.x at every boundary — new CLI flags (`--retry-failed`, extended `--max`), persisted checkpoint JSON columns (frozen id list, scope arrays) validated on read.
- Storage: `bun:sqlite` only; one new migration adds `crawl_checkpoint` + child tables. No new disk layout — reuses `store/raw/<dataset_id>/<resource_id>/...`.
- Atomic write: existing `atomicWriteFile` in `src/lib/fs.ts` (already does temp+fsync+rename) replaces the `writeFileSync` at `egov-sync.ts:287`.
- Hashing: existing `sha256Hex` in `src/lib/hash.ts` for both the scope-hash and the dataset-level content validator.

**Storage**:
- New tables in `store/danni.sqlite`: `crawl_checkpoints`, `crawl_checkpoint_datasets`, `crawl_checkpoint_resources` (see data-model.md).
- No change to the on-disk blob layout. Raw egov captures continue at `store/raw/<dataset_uri>/<resource_uri>/raw.<ext>` but are now written atomically.

**Testing**: `bun test` against recorded egov fixtures under `tests/fixtures/` (no live network in the dev loop, per Constitution VI). Interruption/resume is simulated by aborting a run mid-batch and re-invoking against the same in-memory/temp SQLite + temp store root. 100% line + branch coverage enforced (`bun test --coverage`).

**Target Platform**: Linux server (operator-controlled) with Bun 1.x; macOS dev workstation supported.

**Project Type**: Single project — CLI + library (extends the existing `src/crawler/` + `src/manifest/` + `src/store/` tree). No MCP/web surface.

**Performance Goals**:
- Resume re-fetches < 1% of already-captured-and-unchanged resources (SC-001).
- A multi-session run visits every in-scope dataset exactly once (SC-002).
- An interruption loses at most one in-flight resource of work (SC-004).
- A post-completion re-invocation performs zero captures (SC-005).
- The checkpoint commit added per resource is a single small `UPDATE` — negligible against a rate-limited (≤1 req/s) network fetch; does not regress the bun test < 5s budget.

**Constraints**:
- Respectful crawling unchanged (Constitution XI) — this feature only avoids re-fetching; it never loosens rate limits, concurrency, or backoff. Discovery enumerates the id set once per campaign (fewer list calls on resume).
- 100% line + branch coverage (Constitution VIII).
- Cyrillic preserved byte-exact (Constitution X) — the dataset-uri sort and scope-array normalization (lowercase + dedupe) operate on ids/slugs, never on authoritative Cyrillic title/description fields.
- Single-process operation; mutual exclusion enforced by the one `sync_runs_lock` row (Constitution IV / 001 FR-017c).
- Authoritative fields immutable post-capture — checkpoint rows are derived progress state, never a rewrite of dataset/resource authoritative columns.

**Scale/Scope**:
- ~12k datasets, tens of thousands of resources per the spec. The frozen sorted id list (one TEXT JSON array of ~12k uris ≈ low hundreds of KB) and one checkpoint-dataset + checkpoint-resource row per unit are comfortable for SQLite.
- A campaign = one scope-hash; multiple bounded sessions compose into full coverage.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence in this plan |
|---|-----------|--------|------------------------|
| I | AI-Native Development | ✅ PASS | No read-path change; progress is exposed as structured JSON (status command + manifest). Authoritative portal data is untouched — checkpoint rows are pure derived progress. |
| II | Spec-Driven Development | ✅ PASS | spec.md (WHAT, with both 2026-06-03 clarification rounds) → this plan (HOW) → tasks.md (next) → `bun test` (VALIDATION). |
| III | Contract-First API Design | ✅ PASS | New CLI flags (`--retry-failed`, extended `--max`) get Zod-validated parsing; the checkpoint is an internal persistence contract documented in data-model.md. No new portal endpoint is consumed (reuses `EgovBgClient` methods already in `specs/portal-api/`); no new MCP tool. |
| IV | Operational Excellence | ✅ PASS | Crawl now runs inside `beginSyncRun` → structured per-resource events, audit `sync_runs` record, notifier on failure/threshold (FR-007). `status` surfaces discovered/captured/failed/remaining (FR-006). Safe stop + clean resume (FR-006). Graceful degradation: lost checkpoint → safe re-scan (FR-008). |
| V | Simplicity & YAGNI | ✅ PASS | Reuses existing primitives: `beginSyncRun`, `atomicWriteFile`, `BlobStore`, `sha256Hex`, the migration runner. No new dependency, no new disk layout, no parallelism (explicitly out of scope per spec). One new table family, justified by FR-001. |
| VI | Fast Feedback Loops | ✅ PASS | `bun test` against recorded fixtures; interruption simulated in-process (no live network). Per-resource checkpoint commit is one small UPDATE — keeps the unit suite < 5s. |
| VII | Type Safety & Validation | ✅ PASS | TS strict; Zod on new CLI flags and on the persisted checkpoint JSON columns (frozen id list, scope arrays) at read time (data-model.md §4). |
| VIII | 100% Test Coverage & Endpoint Parity | ✅ PASS | Plan provisions unit tests per new module (scope-hash, checkpoint repo, resume planner, atomic capture) + integration tests for the three user stories (interrupt/resume, bounded sessions, status/stop) + edge cases (catalog change, lost checkpoint, capped failure). No new consumed endpoint → parity matrix unaffected; the existing egov endpoints already have contract tests. 100% line+branch enforced. |
| IX | Data Freshness & Sync Integrity | ✅ PASS | Per-resource completion granularity keeps the on-disk corpus and checkpoint mutually consistent (SC-003). The dataset-level validator (`source_etag_or_hash` from `updated_at`/`version`) is the freshness signal for "unchanged" (FR-002); atomic capture guarantees no bytes recorded without their file present (FR-005). Runs through `sync_runs` audit trail (FR-007). |
| X | Bulgarian-Locale Awareness | ✅ PASS | Sort key is the dataset **uri** (ASCII slug/id), and scope-array normalization (lowercase+dedupe) is applied to ids/slugs only — never to authoritative Cyrillic fields. Cyrillic round-trip of captured bytes is preserved because the capture path is unchanged except for atomicity. |
| XI | Respectful Crawling | ✅ PASS | Resume strictly reduces requests (skips captured-unchanged units; enumerates ids once per campaign). No change to rate limiter, concurrency cap, backoff, robots, or User-Agent. `--retry-failed` is bounded by per-row max attempts so a persistently failing unit never hammers the portal. |

**Result**: All gates PASS. No new violations; no Complexity Tracking entries required beyond the migration-numbering coordination flag (an inter-feature process note, not a constitution violation — see Complexity Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/004-crawl-checkpoint-resume/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── spec.md
```

### Source Code (repository root)

Files to **add**:

```text
src/crawler/
├── scope-hash.ts            # FR-003a: SHA-256 over canonical JSON of the 4 sorted+deduped+lowercased scope arrays; "all" sentinel for empty scope
├── crawl-checkpoint.ts      # Resume planner: build/load a campaign, compute the frozen sorted id list, decide skip/fetch/retry per dataset+resource, advance the cursor
└── egov-validator.ts        # Derive a dataset-level validator (source_etag_or_hash) from getDatasetDetails (updated_at/version → hash); decides "unchanged"

src/store/repos/
└── crawl-checkpoints.ts     # Repo for crawl_checkpoints + crawl_checkpoint_datasets + crawl_checkpoint_resources (upsert, mark complete/failed, attempt counts, counts/remaining queries)

migrations/
└── 00N_crawl_checkpoint.sql # New table family (N = next free number — SEE Complexity Tracking: coordinate with 002/003)
```

Files to **modify**:

```text
src/crawler/egov-sync.ts     # Refactor runEgovSync to (1) run inside a passed SyncRunHandle, (2) consume the resume plan from crawl-checkpoint.ts, (3) replace writeFileSync (line 287) with atomicWriteFile, (4) record per-resource completion + recordEvent, (5) honor --max as a per-session dataset batch advancing the cursor, (6) honor retryFailed
src/crawler/run-egov-sync.ts # NEW orchestrator (mirrors run-sync.ts): calls beginSyncRun, builds/loads the checkpoint, drives runEgovSync, finalizes the run + notifier. (May instead live as an exported function alongside runEgovSync — see Phases.)
src/cli/sync.ts              # Route egov path through the new beginSyncRun-wrapped orchestrator; pass notifier; handle LockContentionError (exit 5) like the CKAN path; add --retry-failed; clarify --max semantics in --help
src/store/repos/sync-run-events.ts  # (only if needed) confirm event outcomes cover egov capture; no schema change expected — reuses existing outcomes
```

Files to **read but not change** (the contracts this feature honors):

```text
src/manifest/sync-run.ts     # beginSyncRun / SyncRunHandle / LockContentionError — reused as-is
src/manifest/writer.ts       # ManifestTotals / ManifestDatasetEntry — reused as-is
src/store/blob-store.ts      # content-addressed reuse for FR-008 safe re-scan
src/lib/fs.ts                # atomicWriteFile (FR-005 primitive)
src/lib/hash.ts              # sha256Hex (scope-hash + validator)
```

Tests to **add** (under `tests/`, mirroring the 001 layout):

```text
tests/unit/scope-hash.test.ts
tests/unit/crawl-checkpoints-repo.test.ts
tests/unit/crawl-checkpoint-planner.test.ts
tests/unit/egov-validator.test.ts
tests/integration/egov-resume.test.ts          # US1: interrupt → resume, < 1% re-fetch (SC-001/SC-004/SC-005)
tests/integration/egov-bounded-sessions.test.ts # US2: multi-session exact-once coverage (SC-002)
tests/integration/egov-status-stop.test.ts      # US3: progress + safe stop (FR-006)
tests/integration/egov-edge-cases.test.ts       # lost checkpoint (FR-008), catalog change (FR-004), capped failure + --retry-failed (FR-009), atomic capture (SC-003)
```

**Structure Decision**: Single-project layout, organized by pipeline stage (the existing
convention). New crawl-resume logic lives under `src/crawler/` next to `egov-sync.ts`; the
new repo lives under `src/store/repos/` next to its peers. The orchestration boundary
mirrors `run-sync.ts` so the egov and CKAN paths converge on the same `beginSyncRun`
lifecycle. No new top-level directory is introduced (Constitution V).

## Implementation Phases / Approach

Ordered so each phase is independently testable and the P1 user stories land first.

**Phase 0 — Research** (research.md): resolve the five design unknowns — scope-hash
canonicalization, the frozen-id-list materialization given page-only pagination, the
egov dataset-level validator (no HTTP ETag), the `beginSyncRun` wrapping seam, and the
atomic-capture swap. (Done in research.md.)

**Phase 1 — Persistence + primitives** (no behavior change yet):
1. Write migration `00N_crawl_checkpoint.sql` (data-model.md §2) — `crawl_checkpoints`,
   `crawl_checkpoint_datasets`, `crawl_checkpoint_resources` + indexes.
2. `src/crawler/scope-hash.ts` — `computeScopeHash(scope)` (FR-003a). Unit-test the
   sort/dedupe/lowercase/"all"-sentinel rules and that a scope change yields a new hash.
3. `src/store/repos/crawl-checkpoints.ts` — CRUD + `markResourceDone`, `markResourceFailed`
   (attempt++), `markDatasetComplete`, `counts()`/`remaining()` (excludes capped failures
   per FR-009). Unit-test in isolation against a migrated temp DB.
4. `src/crawler/egov-validator.ts` — `datasetValidator(details)` → stable hash of
   `updated_at`+`version` (fallback: hash of canonical metadata). Unit-test.

**Phase 2 — Refactor egov into `beginSyncRun` + atomic capture** (FR-007, FR-005):
5. Introduce the orchestrator (`run-egov-sync.ts` or an exported `runEgovSyncRun`) that
   calls `beginSyncRun`, runs the crawl, finalizes, and dispatches the notifier — mirroring
   `run-sync.ts`. `runEgovSync` accepts a `SyncRunHandle` and records `recordEvent` per
   resource/dataset.
6. Replace `writeFileSync` (egov-sync.ts:287) with `atomicWriteFile`; record the capture
   (`resourcesRepo.recordCapture` + checkpoint resource row) only **after** the rename.
7. Wire `src/cli/sync.ts` egov branch to the orchestrator; pass the notifier; map
   `LockContentionError` → exit 5 (parity with CKAN). Verify the lock makes egov+CKAN
   mutually exclusive.
   *Checkpoint*: the existing egov capture behavior is preserved, now atomic and audited —
   regression-safe before resume logic is added.

**Phase 3 — Resume planner + cursor** (US1, FR-001/FR-002/FR-003/FR-004):
8. `src/crawler/crawl-checkpoint.ts` — on campaign start, enumerate the full in-scope id set
   once (reusing `EgovBgClient.listDatasets` paging), sort by uri, persist the frozen list.
   On resume, load it; the cursor = last completed uri. Produce a per-unit plan:
   skip (validator unchanged AND all resources captured) / fetch / (retry only if flagged).
9. `runEgovSync` consumes the plan: skips captured-unchanged datasets/resources, captures
   the rest, advances+persists the cursor per dataset; `--max` bounds the per-session
   dataset count. Per-resource completion committed before moving on (≤1 resource lost on
   interruption).
   *Checkpoint*: US1 + US2 acceptance scenarios pass.

**Phase 4 — Observability, retry, degradation** (US3, FR-006/FR-008/FR-009):
10. Surface discovered/captured/failed/remaining via the existing `status` command and the
    manifest totals. `--retry-failed` re-attempts recorded failures bounded by
    max-attempts; `remaining` excludes capped failures.
11. Lost/corrupt checkpoint → fall back to a full re-scan that still reuses on-disk content
    (content-addressed blob reuse) so no captured bytes are re-downloaded (FR-008).
    *Checkpoint*: US3 + all edge cases pass; 100% coverage gate green.

**Phase 5 — Polish**: docs (quickstart.md), `--help` text, parity-matrix re-check (no new
endpoint), full `bun test --coverage` green.

## Complexity Tracking

| Violation / Coordination item | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| **Migration numbering must be coordinated across three concurrent features.** The next free numeric prefix is **004** (existing: `001_core`, `002_curate_enrich`, `003_index`). But sibling features `002-batch-embedding` and `003-incremental-indexing` are also in flight (each currently has only `spec.md`, no plan, so neither has claimed a migration yet). The migration runner (`src/store/migrate.ts`) enforces unique integer prefixes and a **checksum lock** — two features both shipping `004_*.sql` would collide, and editing an already-applied file fails the checksum check. | A durable cross-session checkpoint requires its own committed schema; it cannot reuse 001/002/003 without violating the checksum lock. | "Just grab 004" rejected as unsafe in isolation: whichever of the three features merges first takes 004; the others must rebase to 005/006. **This plan proposes `006_crawl_checkpoint.sql` but flags that the merge order decides the final number — the implementer MUST confirm the next free prefix at merge time and renumber if 002/003-batch/incremental land first.** Recorded here and in data-model.md so it is not silently assumed. |
| Refactoring `runEgovSync` into `beginSyncRun` touches a shipped code path. | FR-007 is explicit and resolves a real correctness gap (egov currently bypasses the lock → can race CKAN; loses all progress on interrupt). | "Add a second, egov-only lock" rejected: the spec (round-2 clarification) requires the **single** `sync_runs_lock` so egov and CKAN are mutually exclusive; a separate lock would let both run and corrupt shared store state. |
## Cross-Spec Coordination (review 2026-06-04)

Features 002/003/004 were planned in parallel and share infrastructure; a cross-spec review reconciled:

- **Migration numbering (canonical, collision-free):** `004_index_failures.sql` (002), `005_index_state.sql` (003), `006_crawl_checkpoint.sql` (004). All are additive and order-independent; `src/store/migrate.ts` should also gain a duplicate-prefix guard.
- **run-index composition (002 ↔ 003): land 003 first.** 003 owns the per-dataset incremental loop (fingerprint check → FTS upsert + `content_fp`; embed + `embed_fp`/`model_id`, each in its own transaction; model identity read once at run start). 002 then batches **only the changed/selected set** 003 yields, persisting each vector with its `embed_fp`/`model_id`. The two MUST share one merged `run-index` loop, not two competing rewrites.
- **Orphan purge:** 003's every-run reconcile-vs-`listActive()` purge MUST also clear 002's `index_failures` rows for non-active datasets.
- **004 orchestrator:** the egov crawl is wired through `src/crawler/run-sync.ts`, sharing the single `sync_runs_lock` (egov & CKAN mutually exclusive); egov exit codes mirror the CKAN path.
