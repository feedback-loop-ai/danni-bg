---

description: "Task list for 005-pipeline-hardening"
---

# Tasks: Pipeline Correctness & Traceability Hardening

> **Status (2026-06-04): Implemented.** Every task below is complete and exercised by the test suite (737 tests green, up from 734; lint + typecheck clean; the parity-matrix and migrate-smoke gates pass). This was a RETROFIT: the five fixes shipped on branch `005-pipeline-hardening` before the spec/plan/tasks records were written, then these artifacts were reconciled against the green suite and the changed source rather than re-derived task-by-task (research.md R5).

**Input**: Design documents from `/specs/005-pipeline-hardening/`
**Prerequisites**: plan.md, spec.md (incl. the `### Session 2026-06-04` clarification block), research.md (R1–R6), data-model.md, quickstart.md

**Tests**: Tests are MANDATORY for this feature (Constitution Principles VII, VIII: 100% line + branch coverage, TDD — write failing tests FIRST). This feature adds **no new portal endpoint and no new published read contract**: the `index-entry` schema is unchanged (`additionalProperties:false`), only the emitted `curatedDatasetPath` value is corrected to honor its existing "relative path under store/curated/" description, and the new `runPortalSync` dispatch is an **internal** contract (research.md R6). So — exactly like 002 and 003 — there is **no `contracts/` directory and no parity-matrix entry to add**; instead the mandatory tests are the tightened index-entry contract test (relative path, equals `d1`, sourceUrl), the portal-sync dispatch truth table (egov-bg→listDatasets only / ckan→package_search only), and the five-stage end-to-end traceability test.

## Implementation status

Complete. All tasks below are `[x]` — implemented and verified by the test suite (see the status note above).

**Organization**: Tasks are grouped by user story (US1 = P1 traceable results, US2 = P1 live-portal scheduled crawl, US3 = P2 no silent stub, US4 = P2 end-to-end safety net, US5 = P3 truthful spec/task records) to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Different files, no dependencies on incomplete tasks in the same phase
- **[Story]**: User-story phase tasks only (US1–US5)
- Every task includes an exact file path
- **TDD**: every test task is written and made to FAIL before the implementation task it guards

## Path Conventions

Single-project layout (inherited from 001, plan.md §Project Structure):
- Source confined to: `src/index/query.ts`, `src/index/embedders/local-onnx.ts`, `src/cli/{search.ts,index-cmd.ts,sync.ts,schedule.ts}`, plus the new internal dispatch module `src/crawler/portal-sync.ts`
- No new migration (no schema change); no `contracts/` directory (internal dispatch only)
- Tests: `tests/contract/index-entry.test.ts`, `tests/unit/crawler/portal-sync.test.ts`, `tests/integration/pipeline-e2e.test.ts`
- Read-only deps: `src/store/repos/curated-artifacts.ts` (`CuratedArtifactsRepo.byDataset`), `src/store/repos/entities.ts` (`EntitiesRepo.get`), `src/crawler/{ckan-client.ts,egov-bg-client.ts,run-sync.ts,run-egov-sync.ts,http.ts,rate-limit.ts,backoff.ts,robots.ts}`, `src/config/schema.ts` (`crawler.robots.obey`/`allowHosts`, `portal.api`)

---

## Phase 1: User Story 1 — Traceable, trustworthy search results (Priority: P1) 🎯 MVP

**Goal**: Every search/entity hit carries a `curatedDatasetPath` that is a real relative path under `store/curated/`, derived from the dataset's actual `curated_artifacts` rows (falling back to the dataset's canonical curated directory — the dataset id — when it has no artifacts yet), never an absolute path; and `searchByEntity()` populates `matchedEntities[].kind` and `.label` (bg + en) from the real entity row instead of the previous hardcoded `kind:'unknown'` / empty label (FR-001, FR-002).

**Independent Test** (quickstart §1): for a dataset with curated artifacts, `search()` and `searchByEntity()` emit a relative `curatedDatasetPath` that resolves on disk under `store/curated/`; an entity-anchored hit carries the matched entity's real kind + bilingual label.

### Tests for User Story 1 (TDD — write FIRST, ensure they FAIL) ⚠️

- [x] T001 [P] [US1] Strengthen the index-entry contract test in `tests/contract/index-entry.test.ts` beyond a bare `z.string()`: assert the hit's `curatedDatasetPath` is relative (does not start with `/`), equals the dataset's canonical curated directory (`'d1'` for the no-artifact fallback case), and that `sourceUrl` round-trips the dataset's `source_url` (FR-003) (guards T002).

### Implementation for User Story 1

- [x] T002 [US1] Add `resolveCuratedDatasetPath(artifacts, datasetId)` in `src/index/query.ts` and use it in `search()`: join `CuratedArtifactsRepo.byDataset(datasetId)`, take the top-level directory of a real artifact's `path` (artifacts live at `<datasetId>/<resourceId>/data.*`, so the dataset-level record is that directory), and fall back to the dataset id when there are no artifacts. The result is always a relative path under `store/curated/` — never absolute (FR-001, research.md R1). Satisfies the T001 contract assertions.
- [x] T003 [US1] Fix `searchByEntity()` in `src/index/query.ts` to read `matchedEntities[].kind` and `.label` (bg from `canonical_label_bg`, en from `canonical_label_en`) from `EntitiesRepo.get(entityId)` instead of the previous hardcoded `kind:'unknown'` / empty label (FR-002); ground its `curatedDatasetPath` through the same `resolveCuratedDatasetPath` helper as `search()`. (Depends on T002.)

**Checkpoint**: every search/entity result for a dataset with curated artifacts carries a relative `curatedDatasetPath` that resolves on disk; an entity hit carries the real entity kind + bilingual label (SC-001). MVP shippable here (traceable, non-degraded results).

---

## Phase 2: User Story 2 — Scheduled crawl of the LIVE portal (Priority: P1)

**Goal**: An operator can configure a recurring crawl of `data.egov.bg` (`portal.api='egov-bg'`) and have the scheduler use the egov adapter AND honor the robots opt-out, instead of silently issuing CKAN calls that all fail ("Непознат метод") and re-imposing robots `Disallow:/`. Both the interactive `sync` CLI and the scheduler select the portal client + sync runner through ONE shared dispatch (`runPortalSync`) and build their HTTP stack through ONE shared helper (`buildPortalHttp`) so the two entry points cannot drift (FR-004, FR-005, FR-006).

**Independent Test** (quickstart §2): a dispatched/scheduled run configured for `egov-bg` issues egov endpoints (`listDatasets`) and ZERO CKAN calls; a `ckan` config issues `package_search` and zero egov calls.

### Tests for User Story 2 (TDD — write FIRST, ensure they FAIL) ⚠️

- [x] T004 [P] [US2] Add `tests/unit/crawler/portal-sync.test.ts`: an `egov-bg` config dispatched through `runPortalSync` hits `listDatasets` and never `package_search`; a `ckan` config hits `package_search` and never `listDatasets`. Uses an injectable recording fetcher via `buildPortalHttp(config, fetcher)` with `crawler.robots.obey:false` so the robots check short-circuits and the test is fully offline (research.md R4) (guards T005–T007).

### Implementation for User Story 2

- [x] T005 [US2] Create `src/crawler/portal-sync.ts` with two exports (research.md R3, R4):
  - `buildPortalHttp(config, fetcher?)` → `PortalHttp` — assembles the shared HTTP stack (`RateLimiter` + `BackoffRunner` + `RobotsCache`) applying the robots opt-out (`crawler.robots.obey` / `allowHosts`), with an optional injectable `fetcher` for testability.
  - `runPortalSync(opts)` → discriminated-union `{ api:'ckan'; result } | { api:'egov-bg'; result }`: when `config.portal.api === 'egov-bg'` construct `EgovBgClient` and run `runEgovSyncRun`; otherwise construct `CkanClient` and run `runSync`. Internal contract only — no schema, no parity-matrix entry. Satisfies the T004 dispatch truth table.
- [x] T006 [US2] Rewire `src/cli/sync.ts` onto `buildPortalHttp` + `runPortalSync(trigger:'manual')`, preserving the per-path exit-code semantics (egov: `summaryOutcome==='failed'` → 3 else 0, with the resumable run record emitted to stdout as JSON; ckan: `summaryOutcome==='success'` → 0 else 3) and the `LockContentionError`→5 / generic-error→4 handling. (Depends on T005.)
- [x] T007 [US2] Rewire `src/cli/schedule.ts` onto `buildPortalHttp` + `runPortalSync(trigger:'scheduled')` — so a scheduled crawl of `egov-bg` uses the egov adapter AND the robots opt-out (it previously hardcoded `CkanClient` and omitted the opt-out, re-imposing `Disallow:/`); preserve the overlap-skip → exit 5 path. (Depends on T005.)

**Checkpoint**: a scheduled/dispatched run configured for `egov-bg` issues egov endpoints with zero CKAN calls, and a `ckan` config issues `package_search` with zero egov calls (SC-002); the scheduler honors the robots opt-out via the same helper as `sync`.

---

## Phase 3: User Story 3 — No silent stub semantics (Priority: P2)

**Goal**: When the embedder resolves to the deterministic `local-onnx` hash stub (no injected `embedFn`), both `danni search` and `danni index` warn the operator on stderr — naming the stub model id `local-onnx:hash-stub-32` — so meaningless vectors aren't mistaken for real ones. The warning lives at the CLI boundary, not in the `LocalOnnxEmbedder` constructor (which is used legitimately by many tests with the stub), and MUST NOT fire for an injected real `embedFn` so tests/real models stay quiet (FR-007, research.md R2).

**Independent Test** (quickstart §3): running `danni search`/`danni index` on the default (`local-onnx`) config prints exactly one stub warning to stderr per invocation including `local-onnx:hash-stub-32`; an injected real `embedFn` is silent.

### Implementation for User Story 3

- [x] T008 [P] [US3] Add `LocalOnnxEmbedder.isStub` (a readonly boolean, `true` when no `embedFn` was injected) in `src/index/embedders/local-onnx.ts`. The constructor only exposes the state; it does not warn (research.md R2).
- [x] T009 [US3] Emit the stub warning at `buildEmbedder()` in both `src/cli/search.ts` and `src/cli/index-cmd.ts` when the resolved `LocalOnnxEmbedder.isStub` is true — a single stderr line naming the stub model id (`embedder.id`, e.g. `local-onnx:hash-stub-32`) and pointing at `enrichment.embedder.provider='hosted-api'` for genuine vectors. The `hosted-api` and injected-`embedFn` paths stay silent. (Depends on T008.)

**Checkpoint**: `danni search`/`danni index` on the default config print exactly one stub warning per invocation including `local-onnx:hash-stub-32` (SC-003); injected real embedders are silent.

---

## Phase 4: User Story 4 — End-to-end safety net (Priority: P2)

**Goal**: A single test drives all five stages — sync → curate → enrich → index → search — against one on-disk store, so cross-stage contract drift is caught even though each per-stage suite passes in isolation (FR-008). It asserts one-hop traceability and the translation handoff.

**Independent Test** (quickstart §4): the e2e test captures a CKAN fixture dataset + its CSV, curates/enriches it (with an injected deterministic translator), indexes it, and a title keyword resolves back to a hit whose `sourceUrl` contains `data.egov.bg`, whose `curatedDatasetPath` resolves on disk under `store/curated/`, whose `title.en` is the injected translation, and whose `searchByEntity` recall returns a populated (non-degraded) entity label.

### Tests for User Story 4 (the safety net itself)

- [x] T010 [US4] Add `tests/integration/pipeline-e2e.test.ts`: `runSync` (CKAN fixtures + served CSV bytes) → `runCurate` (with an injected `Translator` stand-in returning `EN:<text>` at confidence 0.9) → `runIndex` → `search`. Assert: a hit for the fixture dataset id; `sourceUrl` contains `data.egov.bg`; `existsSync(join(storeRoot, 'curated', hit.curatedDatasetPath))` is true (curated path resolves on disk, FR-003 e2e leg); `title.en === 'EN:Първи набор от данни'` (the translation flowed sync→curate→index→search); and `searchByEntity` over the dataset's attached entity returns a `matchedEntities[0]` whose `kind` is not `'unknown'` and whose `label.bg` is non-empty (FR-008, exercises US1 + US3 on a real store).

**Checkpoint**: a single test exercises all five stages on one store and asserts one-hop traceability (sourceUrl back to the portal, curated path resolves on disk) plus the translation handoff (SC-001 e2e leg).

---

## Phase 5: User Story 5 — Truthful spec/task records (Priority: P3)

**Goal**: The 001–004 specs and task lists reflect the shipped, tested code (FR-009).

### Implementation for User Story 5

- [x] T011 [US5] Flip the `Status` field of specs 001–004 to terminal in `specs/001-egov-data-sync/spec.md`, `specs/002-batch-embedding/spec.md`, `specs/003-incremental-indexing/spec.md`, `specs/004-resumable-crawl/spec.md`; check every implemented-but-unchecked task box in `specs/002-batch-embedding/tasks.md`, `specs/003-incremental-indexing/tasks.md`, `specs/004-resumable-crawl/tasks.md`, each carrying a `Status (2026-06-04): Implemented` provenance note (reconciled in bulk against the green suite + the subsystem audit, not re-derived task-by-task — research.md R5); and update each "Implementation status" line from "Not started" to "Complete". 001 keeps its two recorded-decision items (T127/T133) as decisions, not pending work.

**Checkpoint**: specs 001–004 show a terminal `Status` and 002/003/004 have zero unchecked-but-implemented task boxes (SC-005).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (US1)** → the traceability fix in `src/index/query.ts`. Self-contained; T001 (test) written first, then T002 → T003 (T003 reuses T002's helper).
- **Phase 2 (US2)** → the live-portal dispatch. T004 (test) written first; T005 (new module) → T006 (sync rewire) ∥ T007 (schedule rewire) — both depend only on T005.
- **Phase 3 (US3)** → the stub warning. T008 (`isStub`) → T009 (CLI warning in two files). Independent of US1/US2.
- **Phase 4 (US4)** → after US1 and US3 (it exercises the grounded `curatedDatasetPath` and the populated entity label on a real store); the e2e test injects a real translator, so the stub warning of US3 does not fire here.
- **Phase 5 (US5)** → after the code lands (it certifies the shipped state); no code dependency.

### User Story Dependencies

- **US1 (P1)** — the traceability/label fix in `query.ts`. No dependency on other stories.
- **US2 (P1)** — the shared portal-sync dispatch. Independent of US1.
- **US3 (P2)** — the stub warning at the CLI boundary. Independent.
- **US4 (P2)** — the five-stage safety net; depends on US1's grounded path + label (asserted end-to-end).
- **US5 (P3)** — record reconciliation; depends only on the work being shipped.

### Parallel Opportunities

- **US1**: T002 then T003 are sequential edits to the same file (`src/index/query.ts`).
- **US2**: T006 ∥ T007 after T005 (different CLI files, same shared module).
- **US3**: T008 (embedder) before T009; T009 edits two CLI files in lockstep (identical warning shape).
- Across stories, T002/T003 (US1) ∥ T005 (US2) ∥ T008 (US3) touch disjoint files and could proceed in parallel; the e2e test (US4) lands last among code tasks.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in the same phase.
- [Story] label maps each task to its user story (US1–US5).
- Tests are MANDATORY and TDD (Constitution VII/VIII): write failing tests first, 100% line + branch coverage. There is **no new portal endpoint and no new published read contract** here — the index-entry schema is unchanged and the portal-sync dispatch is an internal contract — so there is **no `contracts/` directory and no parity-matrix entry** (research.md R6), exactly like 002 and 003. The tightened contract test (T001), the dispatch truth table (T004), and the five-stage e2e (T010) are the correctness guarantees.
- No new migration: the fix corrects the emitted `curatedDatasetPath` value to honor the existing schema description ("relative path under store/curated/"), with no field added.
- The stub warning lives at the CLI boundary, not in the `LocalOnnxEmbedder` constructor, so the many tests that legitimately construct the stub stay quiet; `isStub` exposes the state and the CLI decides to warn (research.md R2).
- The shared `runPortalSync` dispatch makes scheduler/sync drift impossible while preserving each path's existing exit-code semantics (research.md R3); `buildPortalHttp` carries the robots opt-out so the daemon path can never silently re-impose `Disallow:/` (FR-005).
- Commit after each task or logical group; stop at any checkpoint to run `bun test --coverage` and validate before proceeding.
