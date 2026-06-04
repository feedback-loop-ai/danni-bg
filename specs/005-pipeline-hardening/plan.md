# Implementation Plan: Pipeline Correctness & Traceability Hardening

**Branch**: `005-pipeline-hardening` | **Date**: 2026-06-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-pipeline-hardening/spec.md`
**Status**: Implemented (shipped on `005-pipeline-hardening`; verified by the test suite, 2026-06-04)

## Summary

A recap+audit of the danni-bg repo (Bun+TS CLI mirroring data.egov.bg via
sync→curate→enrich→index→search over SQLite) found five cheap, high-leverage
correctness/process defects that were batched and fixed before opening larger feature
tracks. This feature shipped all five:

1. **Traceable search (US1, P1).** `search()` and `searchByEntity()` (`src/index/query.ts`)
   now emit `curatedDatasetPath` as a *relative* path under `store/curated/`, derived from
   the dataset's real `curated_artifacts` rows (`CuratedArtifactsRepo.byDataset`) via a new
   `resolveCuratedDatasetPath(artifacts, datasetId)` helper, falling back to the dataset id
   (its canonical curated directory) when there are no artifacts yet. `searchByEntity()`'s
   `matchedEntities[]` now reads the real `kind` + bilingual `label` from `EntitiesRepo.get`,
   replacing the hardcoded `kind:'unknown'` / empty label.
2. **Live-portal scheduling (US2, P1).** A new internal module `src/crawler/portal-sync.ts`
   exposes one shared dispatch — `runPortalSync(opts)` (a discriminated union over
   `config.portal.api`: `ckan`→`CkanClient`+`runSync`, `egov-bg`→`EgovBgClient`+`runEgovSyncRun`)
   and `buildPortalHttp(config, fetcher?)` (rate-limit + backoff + robots, applying the
   `crawler.robots.obey`/`allowHosts` opt-out). Both `src/cli/sync.ts` and `src/cli/schedule.ts`
   were rewired onto it, so the scheduler can no longer hardcode `CkanClient` (which made every
   live-portal fire fail with "Непознат метод") nor re-impose robots `Disallow:/`.
3. **No silent stub semantics (US3, P2).** `LocalOnnxEmbedder` exposes `isStub` (true when no
   `embedFn` was injected); the CLI boundary (`buildEmbedder` in `src/cli/search.ts` and
   `src/cli/index-cmd.ts`) warns on stderr — naming `local-onnx:hash-stub-32` — when the stub is
   in use, and stays quiet for an injected real embedder.
4. **End-to-end safety net (US4, P2).** A single integration test
   (`tests/integration/pipeline-e2e.test.ts`) drives all five stages against one store, catching
   cross-stage contract drift the per-stage suites miss in isolation.
5. **Truthful records (US5, P3).** Specs 001–004 and the 002/003/004 task lists were reconciled
   to the shipped, tested code.

The read contract (`contracts/index-entry.schema.json`, owned by 001) is unchanged: it already
described `curatedDatasetPath` as a "relative path under store/curated/"; the fix makes the
*emitted value* honor that description. No field was added (`additionalProperties:false`).

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, `noUncheckedIndexedAccess`, no `any`
outside type guards) — unchanged from 001.
**Primary Dependencies**:
- Runtime: Bun 1.x with `bun:sqlite` (existing `openDb` in `src/store/db.ts`).
- Crawler stack: existing `RateLimiter`, `BackoffRunner`, `RobotsCache`, `PortalHttp`
  (`src/crawler/`), `CkanClient`, `EgovBgClient`, `runSync`, `runEgovSyncRun` — composed, not
  changed, by `portal-sync.ts`.
- Repos: existing `CuratedArtifactsRepo`, `EntitiesRepo`, `DatasetsRepo`,
  `OrganizationsRepo`, `TranslationsRepo` (`src/store/repos/`) — `query.ts` joins
  `CuratedArtifactsRepo.byDataset` and `EntitiesRepo.get`.
- Validation: Zod ^3.25.x. **No new config schema** — the dispatch reads existing
  `config.portal.api`, `config.crawler.robots.*`, and `config.enrichment.embedder`.
- Testing: `bun test` + coverage per 001's Complexity Tracking decision (Vitest hangs under
  Bun with `bun:sqlite`).
- Lint/Format: Biome.

**Storage**: **No new table and no new on-disk blob layout.** `curatedDatasetPath` is now
*derived* from existing `curated_artifacts` rows + the existing `<datasetId>/<resourceId>/data.*`
mirror layout; the relative directory path equals the dataset id by construction.

**Testing**: `bun test` against in-memory/temp SQLite stores. The dispatch tests use an
injected recording `fetcher` and `obey:false` (which short-circuits `RobotsCache`, so no
`robots.txt` is fetched) — fully offline (Principle VI). The e2e test seeds CKAN fixtures + a
CSV resource and injects a deterministic translator and a fixed-dimension `LocalOnnxEmbedder`.

**Target Platform**: Linux server / macOS dev — unchanged from 001.

**Project Type**: Single project — CLI + library. The work spans `src/index/`, `src/cli/`, and
the new `src/crawler/portal-sync.ts`.

**Performance Goals**: No new hot path. `resolveCuratedDatasetPath` adds one
`CuratedArtifactsRepo.byDataset` lookup per returned hit (bounded by the result limit). The
dispatch adds no per-request cost beyond the client/runner it already selected.

**Constraints**:
- 100% line + branch coverage (Principle VIII): every new branch — the artifact-present vs
  fallback path in `resolveCuratedDatasetPath`, both `runPortalSync` arms, and both stub/non-stub
  CLI warning paths — is covered.
- Cyrillic preserved byte-exact (Principle X): the entity `label.bg` and translated `title.en`
  pass through unchanged; the e2e test asserts on Cyrillic fixtures.
- `curatedDatasetPath` MUST NOT be absolute (must not start with `/`) — asserted by the
  contract test (FR-003).
- The robots opt-out wiring in `buildPortalHttp` mirrors the already-tested `sync.ts` path
  (covered by `respectful-crawler`); the dispatch tests deliberately stay offline (R4).

**Scale/Scope**: Confined to five fixes. No schema, no migration, no external contract change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence in this plan |
|---|-----------|--------|------------------------|
| I | AI-Native Development | ✅ PASS | All five fixes harden *derived* outputs and process records; no authoritative portal data is mutated. The corrected `curatedDatasetPath` and populated entity labels make the structured search result *more* machine-trustworthy, not less. |
| II | Spec-Driven Development | ✅ PASS | spec.md (WHAT, five user stories) → this plan + research.md (HOW) → tasks.md → `bun test` (VALIDATION). US5 itself enforces this principle retroactively across 001–004. |
| III | Contract-First API Design | ✅ PASS | **No new contract.** The index-entry read contract is unchanged; the fix makes the emitted value honor its existing "relative path under store/curated/" description (R6). `runPortalSync`/`buildPortalHttp` are an *internal* dispatch contract (typed discriminated union), correctly NOT placed in `contracts/`. No new MCP tool, no new portal endpoint. |
| IV | Operational Excellence | ✅ PASS | The stub warning (FR-007) is operability surfacing — the operator is told on stderr when semantic ranking is meaningless. The scheduler fix turns a silently-failing daemon path into a working one with the same exit-code semantics. |
| V | Simplicity & YAGNI | ✅ PASS | Each fix is the minimal change: one helper (`resolveCuratedDatasetPath`), one boolean (`isStub`), one shared dispatch module replacing duplicated branches. No new config, no new table, no new contract, no new dataset-level record file (R1 rejected the larger alternatives). |
| VI | Fast Feedback Loops | ✅ PASS | Dispatch tests are offline (`obey:false` short-circuits robots; injected fetcher). The e2e test runs against a temp store with a stub embedder and an injected translator — no network, no live model. `bun test` stays fast. |
| VII | Type Safety & Validation | ✅ PASS | `RunPortalSyncResult` is a typed discriminated union (`{api:'ckan'…} \| {api:'egov-bg'…}`) the callers narrow on; `LocalOnnxEmbedder.isStub` is a typed `readonly boolean`; `resolveCuratedDatasetPath` is typed over `CuratedArtifactRow[]`. No `any`, no new JSON columns. |
| VIII | 100% Test Coverage & Endpoint Parity | ✅ PASS | TDD per fix: the strengthened contract test (T001) precedes the path fix (T002–T003); the dispatch test (T004) precedes the module (T005) and the rewiring (T006–T007); the e2e test (T010) is the cross-stage net. Parity matrix unaffected (no new endpoint). Suite: 737 pass / 0 fail (was 734). |
| IX | Data Freshness & Sync Integrity | ✅ PASS | The scheduler fix (US2) directly restores sync integrity for the live portal: a scheduled `egov-bg` run now actually captures data instead of failing every call. No authoritative field is mutated. |
| X | Bulgarian-Locale Awareness | ✅ PASS | Entity `label.bg` / `canonical_label_bg` and the BG→EN `title.en` handoff are passed byte-exact; the e2e test asserts on Cyrillic ("Първи набор от данни", "набор"). No case-folding in the new path. |
| XI | Respectful Crawling | ✅ PASS | `buildPortalHttp` is the single place the robots opt-out (`obey`/`allowHosts`) is applied for *both* entry points (FR-005); the scheduler previously omitted it. The opt-out wiring mirrors the `respectful-crawler`-tested `sync.ts` path; the offline dispatch tests use `obey:false` by design (R4). |

**Result**: All gates PASS. No new violations and no new Complexity Tracking entries beyond
the inherited `bun test` decision (001).

## Project Structure

### Documentation (this feature)

```text
specs/005-pipeline-hardening/
├── plan.md              # This file
├── research.md          # Phase 0 output (R1–R6)
├── data-model.md        # IndexEntry semantics clarification + PortalSync dispatch contract
├── quickstart.md        # Per-fix verification + SC checklist
├── spec.md
└── tasks.md             # Created by /speckit-tasks
```

No `contracts/` directory — exactly like 002 and 003. This feature introduces no MCP tool, no
portal endpoint, and no new published read contract. The index-entry schema (owned by 001) is
unchanged; `runPortalSync`/`buildPortalHttp` are an internal dispatch contract.

### Source Code (repository root)

Files to **add**:

```text
src/crawler/
└── portal-sync.ts                 # NEW — buildPortalHttp(config, fetcher?) → PortalHttp
                                    #   (rate-limit + backoff + robots opt-out); runPortalSync(opts)
                                    #   → discriminated union dispatch on config.portal.api
                                    #   (ckan→CkanClient+runSync | egov-bg→EgovBgClient+runEgovSyncRun)

tests/unit/crawler/
└── portal-sync.test.ts            # NEW — egov-bg config hits listDatasets (never package_search);
                                    #   ckan config hits package_search (never listDatasets)

tests/integration/
└── pipeline-e2e.test.ts           # NEW — sync→curate→enrich→index→search on one store;
                                    #   one-hop traceability + translation handoff + entity label
```

Files to **modify**:

```text
src/index/query.ts                 # Add resolveCuratedDatasetPath(artifacts, datasetId); use it in
                                    #   search() (join CuratedArtifactsRepo.byDataset) and
                                    #   searchByEntity(); fix matchedEntities kind+label from
                                    #   EntitiesRepo.get
src/index/embedders/local-onnx.ts  # Add readonly isStub (true when opts.embedFn === undefined)
src/cli/search.ts                  # buildEmbedder(): warn on stderr (naming embedder.id) when isStub
src/cli/index-cmd.ts               # buildEmbedder(): same stub warning
src/cli/sync.ts                    # Rewire onto buildPortalHttp + runPortalSync; preserve egov
                                    #   stdout JSON + per-path exit codes (egov failed→3 else 0;
                                    #   ckan success→0 else 3; lock→5)
src/cli/schedule.ts                # Rewire onto buildPortalHttp + runPortalSync(trigger:'scheduled');
                                    #   egov dispatch + robots opt-out; preserve overlap-skip→exit 5
tests/contract/index-entry.test.ts # Strengthen beyond z.string(): relative (not '/'-prefixed),
                                    #   equals 'd1' for the no-artifact dataset, sourceUrl asserted
specs/00{1,2,3,4}/spec.md          # Flip Status to terminal/Implemented (US5)
specs/00{2,3,4}/tasks.md           # Check implemented task boxes + provenance note (US5)
```

Files **read but not modified** (depended upon):

```text
src/crawler/{ckan-client,egov-bg-client,http,rate-limit,backoff,robots}.ts  # composed by portal-sync
src/crawler/{run-sync,run-egov-sync}.ts                                     # the two runners dispatched
src/store/repos/{curated-artifacts,entities,datasets,organizations,translations}.ts
src/index/embedder.ts                                                        # Embedder interface
src/config/schema.ts               # config.portal.api, crawler.robots.*, enrichment.embedder
```

**Structure Decision**: Single-project layout (inherited from 001). The dispatch lives in
`src/crawler/portal-sync.ts` next to the clients/runners it composes, so the two CLI entry
points (`sync.ts`, `schedule.ts`) import one shared seam and cannot drift (R3). The traceability
and stub fixes are local edits to the modules that own the behavior (`query.ts`, `local-onnx.ts`,
the two CLI `buildEmbedder`s). No new top-level directory.

## Implementation Phases

Ordered, TDD-first (the strengthened/new test precedes the fix it guards, per Principle VIII).
Each fix is independently testable; they share no ordering dependency beyond test-before-code.

**Phase 0 — Research (done).** R1–R6 in research.md resolve `curatedDatasetPath` granularity
(the dataset's curated *directory*, grounded in real artifact rows — not a per-resource file or
a new record file), the warn-at-CLI-boundary decision (vs the embedder ctor), the single-dispatch
decision (vs duplicated branches), the offline-testability of `buildPortalHttp` (injectable
fetcher + `obey:false`), the bulk task-checkbox reconciliation against the green suite, and the
no-migration / no-new-contract conclusion.

**Phase 1 — Traceable search (US1, P1).**
1. **T001** Strengthen `tests/contract/index-entry.test.ts` beyond `z.string()`:
   `curatedDatasetPath` is relative (does not start with `/`), equals `'d1'` for a dataset with
   no curated artifact, and `sourceUrl` round-trips. (Guards T002.)
2. **T002** Add `resolveCuratedDatasetPath(artifacts, datasetId)` in `src/index/query.ts` (take
   the top path segment of the first non-empty artifact `path`, else the dataset id) and use it
   in `search()`, joining `CuratedArtifactsRepo.byDataset`.
3. **T003** Fix `searchByEntity()` so `matchedEntities[]` reads `kind` + `canonical_label_bg/en`
   from `EntitiesRepo.get(entityId)` (no more `kind:'unknown'`/empty), and ground its
   `curatedDatasetPath` through the same helper.

**Phase 2 — Live-portal scheduling (US2, P1).**
4. **T004** Add `tests/unit/crawler/portal-sync.test.ts`: an `egov-bg` config hits `listDatasets`
   and never `package_search`; a `ckan` config hits `package_search` and never `listDatasets`
   (recording fetcher + `obey:false` for an offline test). (Guards T005–T007.)
5. **T005** Create `src/crawler/portal-sync.ts`: `buildPortalHttp(config, fetcher?)` building the
   rate-limit + backoff + robots(obey/allowHosts) stack, and `runPortalSync(opts)` returning the
   `{api:'ckan',result} | {api:'egov-bg',result}` discriminated union.
6. **T006** Rewire `src/cli/sync.ts` onto `buildPortalHttp` + `runPortalSync`, preserving the egov
   stdout JSON line and per-path exit codes (egov `failed`→3 else 0; ckan `success`→0 else 3;
   lock contention→5).
7. **T007** Rewire `src/cli/schedule.ts` onto `buildPortalHttp` + `runPortalSync(trigger:'scheduled')`
   — egov dispatch + robots opt-out via the shared helper; preserve overlap-skip→exit 5.

**Phase 3 — No silent stub semantics (US3, P2).**
8. **T008** Add `LocalOnnxEmbedder.isStub` (`readonly`, true when `opts.embedFn === undefined`) in
   `src/index/embedders/local-onnx.ts`.
9. **T009** Emit the stub warning at `buildEmbedder()` in `src/cli/search.ts` and
   `src/cli/index-cmd.ts` when `isStub`, naming `embedder.id` (`local-onnx:hash-stub-32`); silent
   for an injected real `embedFn` (R2).

**Phase 4 — End-to-end safety net (US4, P2).**
10. **T010** Add `tests/integration/pipeline-e2e.test.ts`: `runSync` (CKAN fixtures + served CSV) →
    `runCurate` (inject a deterministic translator) → `runIndex` → `search`. Assert the hit's
    `sourceUrl` contains `data.egov.bg`, `curatedDatasetPath` resolves on disk under
    `store/curated/`, `title.en` came from the injected translator, and `searchByEntity` returns a
    populated (non-`unknown`) entity label.

**Phase 5 — Truthful records (US5, P3).**
11. **T011** Flip specs 001–004 `Status` to terminal; check every implemented-but-unchecked task
    box in 002/003/004 `tasks.md`; add a "Status (2026-06-04): Implemented" provenance note and
    update each "Implementation status" line from "Not started" to "Complete". The reconciliation
    was done in bulk against the green suite + the subsystem audit, not re-derived task-by-task,
    and each `tasks.md` says so (R5); 001 keeps its two recorded-decision items (T127/T133).

**Phase 6 — Gates.** Full suite green with the additions (737 pass / 0 fail, up from 734); Biome
lint + typecheck clean; the parity-matrix and migrate-smoke gates pass (neither is affected — no
new endpoint, no new migration).
