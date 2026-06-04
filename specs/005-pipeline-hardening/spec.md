# Feature Specification: Pipeline Correctness & Traceability Hardening

**Feature Branch**: `005-pipeline-hardening`  
**Created**: 2026-06-04  
**Status**: Implemented (shipped on `005-pipeline-hardening`; verified by the test suite, 2026-06-04)  
**Input**: User description: "After a recap+audit of the danni-bg repo, batch five cheap, high-leverage correctness/process fixes before starting larger feature tracks: the live-portal scheduler path could never work, search hits weren't reliably traceable to curated data, the semantic stub was silently presented as real, no test chained all five stages, and the 002/003/004 spec/task records had drifted from shipped code."

## Clarifications

### Session 2026-06-04

- Q: What is the granularity of `curatedDatasetPath` — a single per-resource file or a directory? → A: The dataset's curated **directory**. The "curated dataset record" is the composed `mirror-info`/`datasetView`, never persisted as one file; the directory holds the per-resource artifacts. By the on-disk layout (`<datasetId>/<resourceId>/data.*`) the directory's relative path equals the dataset id. The old code emitted that id incidentally; it is now derived from the real `curated_artifacts` rows so it is grounded/validated, with a fallback to the dataset id when no artifacts exist yet.
- Q: Where should the hash-stub warning fire — in the embedder constructor or at the CLI? → A: At the CLI boundary (`buildEmbedder` in `search.ts`/`index-cmd.ts`), not in the `LocalOnnxEmbedder` ctor. The ctor is used legitimately by many tests with the stub, so warning there would spam and mislead. `LocalOnnxEmbedder.isStub` exposes the state; the CLI decides to warn. The index-entry schema is closed (`additionalProperties:false`), so the model id is surfaced via stderr, not a new result field.
- Q: How should the interactive `sync` and the scheduler avoid drifting on portal-API selection and the robots opt-out? → A: One shared dispatch. A new internal `runPortalSync(opts)` selects `CkanClient`+`runSync` vs `EgovBgClient`+`runEgovSyncRun` from `config.portal.api`, and a shared `buildPortalHttp(config, fetcher?)` builds the HTTP stack with the robots opt-out (`crawler.robots.obey`/`allowHosts`). Both entry points route through them, so the bug (the scheduler hardcoded `CkanClient` and omitted the opt-out) cannot recur.
- Q: Does this feature change the database schema or any external contract? → A: No. There is no new migration. The `index-entry` schema already described `curatedDatasetPath` as a "relative path under store/curated/"; the fix makes the emitted value honor that description. There is therefore no `contracts/` directory (matching 002 and 003).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Traceable, trustworthy search results (Priority: P1)

A downstream consumer issuing a search gets, for every hit, a `curatedDatasetPath` that is a real relative path under `store/curated/` resolving to on-disk curated output, plus — for entity-anchored search — the matched entity's real kind and bilingual label, never a degraded placeholder.

**Why this priority**: A search result that can't be traced back to the curated artifact it summarizes is not trustworthy, and an entity hit labeled `kind:'unknown'` with an empty label is unusable downstream. These are the load-bearing read-contract guarantees the index promises (`curatedDatasetPath`, `matchedEntities`); shipping them degraded silently breaks consumers without an error.

**Independent Test**: Index a dataset that has curated artifacts on disk, search for it, and verify the returned `curatedDatasetPath` is relative (does not start with `/`) and `join(storeRoot, 'curated', path)` exists. For a dataset with an attached entity, run `searchByEntity` and verify `matchedEntities[0].kind` is not `'unknown'` and `matchedEntities[0].label.bg` is non-empty.

**Acceptance Scenarios**:

1. **Given** a dataset with one or more `curated_artifacts` rows, **When** `search()` returns it, **Then** its `curatedDatasetPath` is the dataset's curated directory, derived from a real artifact path, and resolves to an on-disk directory under `store/curated/`.
2. **Given** a dataset with no curated artifacts yet, **When** it is returned, **Then** `curatedDatasetPath` falls back to the dataset's canonical curated directory (the dataset id) and is still relative, never absolute.
3. **Given** an entity attached to a dataset, **When** `searchByEntity()` returns that dataset, **Then** `matchedEntities[0]` carries the entity's real `kind` and its bilingual `label` (bg + en) read from the entity row, not a hardcoded placeholder.

---

### User Story 2 - Scheduled crawl of the LIVE portal (Priority: P1)

An operator configures a recurring crawl of data.egov.bg (`portal.api='egov-bg'`) and the scheduler uses the egov adapter and honors the robots opt-out, instead of silently issuing CKAN calls that all fail ("Непознат метод") while re-imposing robots `Disallow:/`.

**Why this priority**: The whole point of the scheduler is unattended mirroring of the live portal. Before this fix the scheduled path had drifted from the interactive `sync` path: it hardcoded `CkanClient` (so every request hit a CKAN endpoint the live portal rejects) and omitted the robots opt-out (so it would re-impose `Disallow:/` and capture nothing). The daemon path therefore could never actually crawl the real portal.

**Independent Test**: Run a dispatched sync with `portal.api='egov-bg'` against a recording fetcher and assert it issues `listDatasets` and zero `package_search` calls; run one with `portal.api='ckan'` and assert the opposite.

**Acceptance Scenarios**:

1. **Given** `config.portal.api='egov-bg'`, **When** a scheduled or dispatched run executes, **Then** it selects the egov adapter (POST `listDatasets`…) and issues zero CKAN `package_search` calls.
2. **Given** `config.portal.api='ckan'`, **When** a run executes, **Then** it selects the CKAN adapter (`package_search`) and issues zero egov calls.
3. **Given** an operator robots opt-out (`crawler.robots.obey=false` or an `allowHosts` entry), **When** the scheduler builds its HTTP stack, **Then** the opt-out is applied through the same `buildPortalHttp` helper as the interactive `sync` path, so the daemon never silently re-imposes `Disallow:/`.

---

### User Story 3 - No silent stub semantics (Priority: P2)

When search or index falls back to the deterministic `local-onnx` hash stub, the operator is warned on stderr (with the stub model id) so meaningless vectors are not mistaken for real semantic ones.

**Why this priority**: The shipped `local-onnx` embedder is a deterministic hash stub, not a real model; its vectors are not semantic. Presenting them silently lets an operator believe semantic ranking is working when only the keyword leg is real. A loud, one-line stderr warning is cheap and prevents that misread. It is P2 because results are still returned and the keyword index is unaffected.

**Independent Test**: Run `danni search` (and `danni index`) on the default `local-onnx` config and verify exactly one stderr warning naming `local-onnx:hash-stub-32` is printed per invocation; run with an injected real `embedFn` and verify no warning fires.

**Acceptance Scenarios**:

1. **Given** the default `local-onnx` (no injected `embedFn`) config, **When** `danni search` or `danni index` runs, **Then** exactly one stderr warning is printed naming the stub model id `local-onnx:hash-stub-32`.
2. **Given** an embedder constructed with an injected real `embedFn`, **When** the same code path runs, **Then** no stub warning is emitted (so tests and real models stay quiet).

---

### User Story 4 - End-to-end safety net (Priority: P2)

A single automated test drives all five stages (sync → curate → enrich → index → search) on one store, so cross-stage contract drift is caught even though each per-stage suite passes in isolation.

**Why this priority**: Each stage has its own green suite, but per-stage suites can all pass while the seams between them (e.g., the curated path emitted by indexing vs. what search resolves, or the translation handoff) silently disagree. One chained test over a single store is the cheapest insurance against that class of regression.

**Independent Test**: On one store, `runSync` (CKAN fixtures + CSV) → `runCurate` (with an injected translator) → `runIndex` → `search`, and assert a hit whose `sourceUrl` contains `data.egov.bg`, whose `curatedDatasetPath` resolves on disk, and whose `title.en` came from the injected translator; then assert `searchByEntity` returns the dataset with a populated entity label.

**Acceptance Scenarios**:

1. **Given** a single store, **When** all five stages run in sequence, **Then** searching a title keyword returns the dataset with `sourceUrl` containing `data.egov.bg` and a `curatedDatasetPath` that exists under `store/curated/`.
2. **Given** an injected deterministic translator during curation, **When** the dataset is indexed and searched, **Then** the hit's `title.en` reflects that translator's output (the handoff survives all five stages).
3. **Given** the same store, **When** `searchByEntity` runs on an attached entity, **Then** it returns the dataset with a non-`unknown` kind and a non-empty bilingual label.

---

### User Story 5 - Truthful spec/task records (Priority: P3)

The 001–004 specs and task lists reflect the shipped, tested code: every implemented-but-unchecked task box is checked, each Status field is terminal, and a provenance note records when and how the reconciliation was done.

**Why this priority**: The audit found the 002/003/004 spec/task records had drifted from shipped code (tasks done in code but left unchecked, "Not started" implementation lines). Records that lie about state mislead future work and erode trust in the Spec Kit artifacts. It is P3 because it is documentation hygiene with no runtime effect.

**Independent Test**: Inspect specs 001–004 and confirm each shows a terminal Status; inspect 002/003/004 `tasks.md` and confirm zero unchecked-but-implemented boxes plus a dated provenance note.

**Acceptance Scenarios**:

1. **Given** specs 001–004, **When** the Status fields are read, **Then** each shows a terminal (implemented) state.
2. **Given** 002/003/004 `tasks.md`, **When** the checkboxes are read, **Then** every implemented task is checked and each file carries a "Status (2026-06-04): Implemented" provenance note, with its "Implementation status" line updated from "Not started" to "Complete".

---

### Edge Cases

- A dataset with multiple curated resources — `curatedDatasetPath` MUST be the single dataset-level directory (the top segment of an artifact path), not one arbitrary per-resource file.
- A dataset with no curated artifacts yet — `curatedDatasetPath` MUST fall back to the dataset id (its canonical curated directory) and remain relative, never absolute, never empty.
- An entity row that is missing for a referenced `entityId` — `searchByEntity` MUST degrade safely (the previous placeholder), but the real entity row MUST be used whenever it exists.
- A real (injected or hosted) embedder — the stub warning MUST NOT fire, so genuine runs and the test suite stay quiet.
- A scheduled run that overlaps a still-running sync — the overlap-skip semantics (exit code 5 under `onOverlap='skip'`) MUST be preserved through the rewire onto `runPortalSync`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `search()` and `searchByEntity()` MUST emit `curatedDatasetPath` as a relative path under `store/curated/`, derived from the dataset's actual `curated_artifacts` rows; when the dataset has no curated artifacts it MUST fall back to the dataset's canonical curated directory (the dataset id). It MUST never be an absolute path.
- **FR-002**: `searchByEntity()` MUST populate `matchedEntities[].kind` and `.label` (bg + en) from the real entity row (`EntitiesRepo`), never the previous hardcoded `kind:'unknown'` / empty label.
- **FR-003**: The index-entry contract test MUST assert `curatedDatasetPath` beyond a bare string: that it is relative (does not start with `/`) and (in the e2e test) resolves to an on-disk path under `store/curated/`.
- **FR-004**: The interactive sync CLI and the scheduler MUST select the portal client + sync runner from `config.portal.api` through ONE shared dispatch function (`runPortalSync`), so the two entry points cannot drift.
- **FR-005**: The scheduler MUST build its HTTP stack through the same helper (`buildPortalHttp`) that applies the robots opt-out (`crawler.robots.obey` / `allowHosts`) — it previously omitted them and would re-impose `Disallow:/`.
- **FR-006**: A scheduled run with `portal.api='egov-bg'` MUST use the egov adapter (POST `listDatasets`…), not CKAN.
- **FR-007**: When the embedder resolves to the local-onnx hash stub (no injected `embedFn`), BOTH `danni search` and `danni index` MUST emit a stderr warning naming the stub model id; the warning MUST NOT fire for an injected real `embedFn` (so tests/real models stay quiet). The warning lives at the CLI boundary, not in the embedder ctor.
- **FR-008**: An automated test MUST exercise sync→curate→enrich→index→search against one store and assert one-hop traceability (`sourceUrl` back to the portal; `curatedDatasetPath` resolves on disk) plus the translation handoff.
- **FR-009**: The Status field of specs 001–004 MUST reflect implemented state, and every implemented-but-unchecked task box in 002/003/004 `tasks.md` MUST be checked, with a provenance note.

### Key Entities

- **IndexEntry** (read contract, `src/index/query.ts` + `contracts/index-entry.schema.json`): The `curatedDatasetPath` semantics are clarified — the dataset's curated directory, grounded in real `curated_artifacts` rows (top path segment, falling back to the dataset id) — and `matchedEntities` labels are populated from the entity row. No field is added; the schema's `additionalProperties:false` is unchanged.
- **PortalSync dispatch** (NEW internal module `src/crawler/portal-sync.ts`): `buildPortalHttp(config, fetcher?)` → `PortalHttp` with rate-limit + backoff + robots(`obey`/`allowHosts`); `runPortalSync(opts)` → discriminated union `{api:'ckan',result}` | `{api:'egov-bg',result}` selecting `CkanClient`+`runSync` vs `EgovBgClient`+`runEgovSyncRun`. Internal contract only (no external schema).
- **LocalOnnxEmbedder.isStub** (boolean): `true` when no `embedFn` is injected; read at the CLI boundary to decide whether to warn.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of search/entity results for datasets with curated artifacts carry a `curatedDatasetPath` that resolves to an on-disk curated directory (verified by the `pipeline-e2e` + search-traceability tests).
- **SC-002**: A scheduled/dispatched run configured for `egov-bg` issues egov endpoints and ZERO CKAN calls; a `ckan` config issues `package_search` and zero egov calls (verified by the `portal-sync` dispatch tests).
- **SC-003**: Running `danni search`/`danni index` on the default (local-onnx) config prints exactly one stub warning to stderr per invocation, including the model id `local-onnx:hash-stub-32`.
- **SC-004**: The full test suite stays green with the additions: 737 pass / 0 fail (was 734), lint + typecheck clean, parity-matrix + migrate-smoke gates pass.
- **SC-005**: Specs 001–004 show a terminal Status and 002/003/004 have zero unchecked-but-implemented task boxes.

## Assumptions

- This is a retrofit: the work is already shipped and verified, so the spec is written in the settled tense and marked Implemented.
- No new database migration: the schema is unchanged.
- No new external contract and therefore no `contracts/` directory (matching 002 and 003): the `index-entry.schema.json` already described `curatedDatasetPath` as a "relative path under `store/curated/`", and this fix makes the emitted value honor that description.
- Builds on the existing pipeline (`sync` → `curate` → `enrich` → `index` → `search` over SQLite) and the existing read contract; it corrects emitted values and centralizes dispatch rather than adding capability.
- The robots opt-out wiring in the scheduler mirrors the already-tested interactive `sync` path (`buildPortalHttp`); the dispatch tests run fully offline by using `robots.obey=false`, which short-circuits the robots check before any `robots.txt` fetch.
- The `local-onnx` embedder remains the deterministic hash stub; surfacing genuine semantic vectors (a real bundled model) is out of scope and unchanged here.
- Out of scope: any new feature capability, schema or contract changes, or re-deriving the 001–004 task lists task-by-task (the checkbox reconciliation was done in bulk against the green suite and the subsystem audit, as each `tasks.md` provenance note records).
