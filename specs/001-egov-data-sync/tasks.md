---

description: "Task list for 001-egov-data-sync"
---

# Tasks: Local Sync of data.egov.bg with Curation and Machine-Readable Index

**Input**: Design documents from `/specs/001-egov-data-sync/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are MANDATORY for this feature (Constitution Principles III, VIII: 100% line + branch coverage, contract tests per consumed CKAN endpoint, round-trip parity tests per Dataset Schema Catalog entry, `tests/parity-matrix.json` checked in CI).

**Organization**: Tasks are grouped by user story (US1 = P1 bootstrap mirror, US2 = P2 curation+enrichment, US3 = P2 indexing) to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Different files, no dependencies on incomplete tasks
- **[Story]**: User-story phase tasks only (US1, US2, US3)
- Every task includes an exact file path

## Path Conventions

Single-project layout per plan.md:
- Source: `src/{cli,crawler,store,manifest,curate,enrich,index,schedule,notify,config,logging,lib}/`
- Tests: `tests/{contract,integration,unit,fixtures/{portal,resources}}/`
- Migrations: `migrations/NNN_*.sql`
- Runtime store (gitignored): `store/{raw,curated,manifest}/, store/danni.sqlite`
- Spec catalogs: `specs/{portal-api,dataset-schemas}/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and tooling.

- [ ] T001 Initialize Bun + TypeScript project at repo root: create `package.json` (name `danni-bg`, type `module`, scripts: `db:migrate`, `lint`, `format`, `test`, `coverage`, `danni`), `tsconfig.json` (`strict: true`, `noUncheckedIndexedAccess: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`), and `bun.lockb` via `bun install`.
- [ ] T002 [P] Configure Biome at `biome.json` (linter + formatter, single source of truth) and add `bun run lint` + `bun run format` scripts; wire pre-commit via `simple-git-hooks` entry in `package.json`.
- [ ] T003 [P] Configure Vitest at `vitest.config.ts` with `@vitest/coverage-v8`; enforce 100% line + 100% branch thresholds (Constitution VIII); set `setupFiles: ['tests/setup.ts']`.
- [ ] T004 [P] Add `.gitignore` covering `store/`, `node_modules/`, `coverage/`, `dist/`, `*.tsbuildinfo`, plus `.gitkeep` placeholders under `store/raw/`, `store/curated/`, `store/manifest/`.
- [ ] T005 [P] Create directory skeleton: `src/{cli,crawler,store,manifest,curate,enrich,index,schedule,notify,config,logging,lib}/` (each with a placeholder `index.ts` that re-exports nothing) and `tests/{contract,integration,unit,fixtures/{portal,resources}}/`.
- [ ] T006 [P] Add `LICENSE` (project license per repo decision) and `README.md` with one-paragraph project summary + a pointer to `specs/001-egov-data-sync/quickstart.md`.
- [ ] T007 [P] Vendor the prebuilt `sqlite-vec` extension binaries under `vendor/sqlite-vec/{linux-x64,linux-arm64,macos-arm64,macos-x64}/` and document the source in `vendor/sqlite-vec/README.md` (reproducibility).
- [ ] T008 [P] Add CI workflow at `.github/workflows/ci.yml` running `bun install`, `bun run lint`, `bun run test --coverage`, and asserting the parity matrix (gate fails on coverage <100% or missing parity entry).
- [ ] T009 [P] Add example config at `danni.config.example.json` matching `specs/001-egov-data-sync/contracts/config.schema.json`; copy as the canonical starting point referenced by `quickstart.md`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure used by every user story. NO user story may start until this phase is complete.

### Logging, Config, Validation

- [ ] T010 Implement structured JSON logger in `src/logging/logger.ts` (level, ts, run_id, dataset_id, resource_id, event, fields), with stderr sink and per-call `child(context)` helper; export `getLogger()` and `withContext()`.
- [ ] T011 [P] Define Zod schemas mirroring `contracts/config.schema.json` in `src/config/schema.ts` (crawler, scope, store, enrichment.translator, enrichment.embedder, schedule, notifier).
- [ ] T012 Implement config loader in `src/config/loader.ts`: read `danni.config.json` (path overrideable via `DANNI_CONFIG`), parse, validate via T011, apply defaults; throw a typed `ConfigError` with field path on failure (Principle VII).
- [ ] T013 [P] Implement shared lib utilities in `src/lib/{ids.ts,hash.ts,time.ts,cyrillic.ts,fs.ts,errors.ts}`: ULID generator, SHA-256 streaming hasher, ISO-8601 helpers (UTC, `Europe/Sofia` formatter), Cyrillic-safe normalization helpers, atomic-write/temp-file utilities, typed error base class.

### SQLite store + migrations

- [ ] T014 Implement migration runner in `src/store/migrate.ts`: discover `migrations/*.sql` ordered by NNN prefix, apply pending in a transaction, record in `schema_migrations`, fail on checksum mismatch of an already-applied file.
- [ ] T015 Implement DB connection helper in `src/store/db.ts`: open `bun:sqlite` against `<store.root>/danni.sqlite`, set `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, load `sqlite-vec` from `vendor/sqlite-vec/<platform>/`, expose `withTransaction()`.
- [ ] T016 Author migration `migrations/001_core.sql` creating `schema_migrations`, `organizations`, `datasets`, `resources`, `sync_runs`, `sync_run_events`, `sync_runs_lock` (seeded with single row `(1, 0, NULL, NULL)`), `schedules` (seeded with single disabled row), `notifications`, `dataset_revisions` per `data-model.md` §1.1–§1.5, §1.10, §1.13–§1.16; include all CHECK constraints and indexes listed.
- [ ] T017 Implement CLI entry dispatcher in `src/cli/danni.ts` and bin script `bin/danni` (`#!/usr/bin/env bun`); parse `argv[0]` subcommand into one of `sync|curate|index|status|search|schedule|mirror-info`; map each to a stub handler under `src/cli/<cmd>.ts`; wire exit codes per `contracts/cli.md` (0/2/3/4/5).
- [ ] T018 Add `db:migrate` script to `package.json` invoking `bun run src/store/migrate-cli.ts`; create `src/store/migrate-cli.ts` that calls T014.

### Foundational tests

- [ ] T019 [P] Unit tests for logger in `tests/unit/logging/logger.test.ts`: level filtering, child-context propagation, JSON shape stable.
- [ ] T020 [P] Unit tests for config loader in `tests/unit/config/loader.test.ts`: valid config, missing required field, invalid enum, default application, `DANNI_CONFIG` override.
- [ ] T021 [P] Unit tests for migration runner in `tests/unit/store/migrate.test.ts`: fresh DB applies all, second run is no-op, checksum drift fails, partial-apply rolls back.
- [ ] T022 [P] Unit tests for `src/store/db.ts` in `tests/unit/store/db.test.ts`: foreign_keys on, WAL mode, sqlite-vec extension loaded (assert `vec_version()` callable).
- [ ] T023 [P] Unit tests for lib utilities in `tests/unit/lib/{ids,hash,time,cyrillic,fs,errors}.test.ts` (one file per module, parallelizable).
- [ ] T024 Create `tests/parity-matrix.json` skeleton with empty `endpoints` and `datasetSchemas` arrays plus a JSON-schema header; CI asserts every consumed CKAN endpoint and every catalog entry has a corresponding test ID listed here (Constitution VIII).

**Checkpoint**: `bun run db:migrate` succeeds on a clean checkout; `bun run test --coverage` passes with 100% line + branch over `src/{logging,config,store,lib}/`. User-story implementation may now begin.

---

## Phase 3: User Story 1 — Bootstrap a complete local mirror (Priority: P1) 🎯 MVP

**Goal**: From an empty machine, `danni sync` discovers every dataset on data.egov.bg, downloads metadata + resource bytes into a byte-faithful local layout under `store/raw/`, writes a `manifest/<run_id>.json` conforming to `contracts/manifest.schema.json`, and persists per-run audit rows in SQLite. Re-runs are incremental (FR-004), respectful (Principle XI), and survive partial failure (FR-006, FR-007).

**Independent Test**: On an empty machine with the full portal scope, `danni sync --scope '{"publishers":["<one-org-id>"]}'` (a) writes a manifest enumerating every dataset returned by `package_search` for that publisher, (b) creates a `store/raw/<dataset_id>/<resource_id>/<sha256>.<ext>` file per resource with matching `bytes` + `sha256` rows in SQLite, (c) a re-run completes in <10% of the first-run wall time and writes 0 new raw files, (d) a forced 404 on one resource leaves the run with exit code 3 and a `failed` event row.

### Migrations + contracts (US1)

- [ ] T025 [US1] Author the **CKAN portal API reference spec** at `specs/portal-api/README.md` plus per-endpoint files `specs/portal-api/{package_list,package_search,package_show,organization_list,organization_show,group_list,group_show,tag_list,resource_get}.md` documenting URL, parameters, success-envelope shape, and error-envelope shape; record each in `tests/parity-matrix.json` (Constitution III, VIII).

### Recorded fixtures (US1)

- [ ] T026 [P] [US1] Capture portal fixtures under `tests/fixtures/portal/{package_list,package_search,package_show,organization_show,group_show,tag_list}/*.json` — small but representative payloads (incl. one Cyrillic title, one missing-resource case, one redirect-chain resource URL) committed verbatim. Document recording procedure at `tests/fixtures/portal/README.md`.
- [ ] T027 [P] [US1] Capture sample raw resource bytes under `tests/fixtures/resources/{csv-cp1251.csv,csv-utf8.csv,json-array.json,xml-sample.xml,xlsx-sample.xlsx,geojson-sample.geojson,binary-pdf.pdf}` — chosen to exercise format detection and Cyrillic preservation.

### Crawler primitives (US1)

- [ ] T028 [P] [US1] Implement Zod schemas for CKAN response envelopes in `src/crawler/ckan-schema.ts` mirroring the per-endpoint shape captured in T025 (`PackageListResponse`, `PackageSearchResponse`, `PackageShowResponse`, `OrganizationShowResponse`, `GroupShowResponse`, `TagListResponse`, `CkanError`).
- [ ] T029 [P] [US1] Implement per-host rate limiter in `src/crawler/rate-limit.ts`: token-bucket keyed by host, configurable `requestsPerSecond` and `concurrency`, async `acquire()`/`release()` (Principle XI).
- [ ] T030 [P] [US1] Implement retry-with-backoff helper in `src/crawler/backoff.ts`: exponential delay with jitter, honors `Retry-After`, configurable `maxRetries` and `failureBudget`; throws typed `RetryExhausted` after budget.
- [ ] T031 [P] [US1] Implement robots.txt cache in `src/crawler/robots.ts`: fetch + parse on first use, re-check on configurable cadence (default 24h), expose `isAllowed(url, userAgent)` (Principle XI).
- [ ] T032 [US1] Implement portal HTTP client in `src/crawler/http.ts` composing T029, T030, T031: identifying `User-Agent` from config, conditional-request support (`If-None-Match`, `If-Modified-Since`), streaming response to a temp file with on-the-fly SHA-256 (R7). Depends on T028–T031.
- [ ] T033 [US1] Implement CKAN action client in `src/crawler/ckan-client.ts` exposing typed methods (`packageList`, `packageSearch`, `packageShow`, `organizationShow`, `groupShow`, `tagList`) over T032; validate every response with T028 schemas; map `success: false` envelopes to typed `CkanApiError`.

### Blob store + manifest writer (US1)

- [ ] T034 [P] [US1] Implement content-addressed blob store in `src/store/blob-store.ts`: `put(stream, declaredFormat) -> {sha256, bytes, relPath}` writes under `store/raw/<dataset_id>/<resource_id>/<sha256>.<ext>` atomically (temp + rename); `exists(sha256)` short-circuits unchanged content (FR-004).
- [ ] T035 [P] [US1] Implement repositories in `src/store/repos/{datasets,resources,organizations,sync-runs,sync-run-events,dataset-revisions,sync-runs-lock}.ts` with typed CRUD + Zod validation on JSON columns at read time (Principle VII).
- [ ] T036 [P] [US1] Implement manifest writer in `src/manifest/writer.ts`: stream-builds `store/manifest/<run_id>.json` conforming to `contracts/manifest.schema.json`; written **once** at run termination (append-once invariant, data-model §4); validate output against the JSON Schema before commit.
- [ ] T037 [US1] Implement sync-run lifecycle manager in `src/manifest/sync-run.ts`: `begin(trigger, scopeFilter) -> runId`, `recordEvent(...)`, `end(summaryOutcome)`; acquires/releases `sync_runs_lock` (FR-017c) inside a SQLite transaction; on abandoned-lock detection at startup, marks the prior run `failed/abandoned`. Depends on T035.

### Discovery + scope filter (US1)

- [ ] T038 [P] [US1] Implement scope-filter evaluator in `src/crawler/scope.ts`: input `{publishers?, groups?, tags?, datasetIds?}`, output a predicate over `DatasetSummary`; an empty filter matches all (FR-018).
- [ ] T039 [US1] Implement discovery pipeline in `src/crawler/discover.ts`: paginate `package_search` (or `package_list` fallback) under the active scope filter, yield `{datasetId, metadata_modified}` stream; emits `discovered` events into the run record. Depends on T033, T038.

### Capture pipeline (US1)

- [ ] T040 [US1] Implement dataset capture in `src/crawler/capture-dataset.ts`: for one dataset id, call `packageShow`, upsert `organizations`, upsert `datasets` (recording field changes into `dataset_revisions`), upsert `resources` rows, return resource list. Depends on T033, T035.
- [ ] T041 [US1] Implement resource capture in `src/crawler/capture-resource.ts`: conditional fetch via T032; on 304 or hash-match → `skipped_unchanged`; on new bytes → blob-store put + update resource row + `captured` event; on failure → `failed` event with reason; honors per-run failure budget. Depends on T032, T034, T035.
- [ ] T042 [US1] Implement withdrawn detector in `src/crawler/withdrawn.ts`: a dataset present in prior run but absent from the current discovery result is recorded as a `withdrawn` event for two-consecutive-run confirmation (FR-016, data-model §2.1); raw bytes are never deleted.
- [ ] T043 [US1] Implement out-of-scope reconciler in `src/crawler/out-of-scope.ts`: datasets whose `lifecycle_state='active'` no longer match the active scope filter transition to `out_of_scope` with an event; rows + raw bytes preserved (FR-018a).
- [ ] T044 [US1] Wire orchestrator in `src/crawler/run-sync.ts` composing T037, T039, T040, T041, T042, T043: drives one `Sync Run` end-to-end, streams progress logs, returns summary outcome; tolerates per-resource failures (FR-006). Depends on T037–T043.

### CLI commands (US1)

- [ ] T045 [US1] Implement `danni sync` in `src/cli/sync.ts` per `contracts/cli.md`: parses `--scope`, `--once`, `--manifest-out`, `--dry-run`; resolves config; dispatches to T044; maps result to exit code 0/3/4/5. Depends on T044, T012, T017.
- [ ] T046 [US1] Implement `danni status` in `src/cli/status.ts` per `contracts/cli.md`: reads `sync_runs` (most recent N), prints human or `--json` (sync-run.schema.json-conforming), reports last-success timestamp, lock-holder, robots cache age (FR-017a). Depends on T035, T017.

### Notifier + scheduler (US1)

- [ ] T047 [P] [US1] Implement notifier interface + providers in `src/notify/{notifier.ts,stderr.ts,webhook.ts}` per R9; persist every dispatch into `notifications` (data-model §1.16).
- [ ] T048 [US1] Wire failure-rate notification in `src/manifest/sync-run.ts`: on `end()`, compute failure rate, dispatch via T047 when rate exceeds `schedule.failure_rate_threshold` or when `summary_outcome='failed'` (FR-017b). Depends on T037, T047.
- [ ] T049 [US1] Implement in-process scheduler in `src/schedule/scheduler.ts` (R6): cron parser, single foreground loop, per-fire calls T044, honors `schedule.on_overlap` (`skip` → exit 5; `queue` → defer one run). Persist next-fire calculation; no daemonization.
- [ ] T050 [US1] Implement `danni schedule` subcommands in `src/cli/schedule.ts` (`install`, `disable`, `show`) per `contracts/cli.md`. Depends on T049, T012.

### Tests for User Story 1

- [ ] T051 [P] [US1] Contract test per CKAN endpoint in `tests/contract/ckan/{package_list,package_search,package_show,organization_show,group_show,tag_list}.test.ts`: replays the recorded fixture into the CKAN client (T033) and asserts the typed response matches the schema captured in `specs/portal-api/`. Each test ID registered in `tests/parity-matrix.json` (Constitution VIII).
- [ ] T052 [P] [US1] Contract test for manifest output in `tests/contract/manifest.test.ts`: end-to-end run produces a `manifest/<run_id>.json` validating against `contracts/manifest.schema.json`.
- [ ] T053 [P] [US1] Contract test for sync-run output in `tests/contract/sync-run.test.ts`: `danni status --json` records validate against `contracts/sync-run.schema.json`.
- [ ] T054 [P] [US1] Unit tests for crawler primitives in `tests/unit/crawler/{rate-limit,backoff,robots,scope,http,ckan-schema,ckan-client}.test.ts` — one file per module, parallelizable (Constitution VIII: 100% line + branch).
- [ ] T055 [P] [US1] Unit tests for store helpers in `tests/unit/store/{blob-store.test.ts,repos/datasets.test.ts,repos/resources.test.ts,repos/sync-runs.test.ts,repos/sync-run-events.test.ts,repos/dataset-revisions.test.ts,repos/sync-runs-lock.test.ts,repos/organizations.test.ts}`.
- [ ] T056 [P] [US1] Unit tests for manifest writer + sync-run lifecycle in `tests/unit/manifest/{writer,sync-run}.test.ts` — append-once invariant, abandoned-lock recovery, failure-budget tripping.
- [ ] T057 [P] [US1] Unit tests for capture pipeline in `tests/unit/crawler/{capture-dataset,capture-resource,withdrawn,out-of-scope,discover}.test.ts` against fixtures.
- [ ] T058 [P] [US1] Unit tests for notifier in `tests/unit/notify/{stderr,webhook}.test.ts`.
- [ ] T059 [P] [US1] Unit tests for scheduler in `tests/unit/schedule/scheduler.test.ts`: cron firing, `on_overlap=skip` returns exit 5, `on_overlap=queue` defers, abandoned-lock reaper.
- [ ] T060 [US1] Integration test: bootstrap-then-resync in `tests/integration/bootstrap-resync.test.ts` against fixtures — fresh DB writes N raw blobs + manifest; second run yields 0 new blobs, all events `skipped_unchanged`; mutate one fixture and assert exactly one `captured` event next run (FR-004, SC-002).
- [ ] T061 [US1] Integration test: per-resource failure tolerance in `tests/integration/failure-budget.test.ts` — inject a 500 on one resource fixture, assert run completes, exit code 3, `failed` event present, other resources captured (FR-006, SC-001).
- [ ] T062 [US1] Integration test: withdrawal + out-of-scope in `tests/integration/lifecycle.test.ts` — second run with the dataset removed from `package_search` produces a `withdrawn` event after two consecutive runs; second run with a narrowed scope filter produces `out_of_scope` events; raw bytes survive both transitions (FR-016, FR-018a).
- [ ] T063 [US1] Integration test: respectful crawler in `tests/integration/respectful-crawler.test.ts` — assert `User-Agent` header, robots.txt enforced (denied path is skipped), rate limiter caps concurrent connections, conditional headers sent on second pass (Principle XI).
- [ ] T064 [US1] Integration test: concurrent-run rejection in `tests/integration/concurrent-runs.test.ts` — start a run, while it holds the lock attempt a second; with `on_overlap=skip` second exits 5; with `on_overlap=queue` second runs after first completes (FR-017c).

**Checkpoint**: `bun run danni sync --scope '<test-scope>'` produces a complete byte-faithful mirror + manifest; `danni status --json` validates against `contracts/sync-run.schema.json`; coverage gate green over US1 modules. **MVP shippable here.**

---

## Phase 4: User Story 2 — Curated, normalized + enriched representation (Priority: P2)

**Goal**: `danni curate` transforms each captured resource into a UTF-8, declared-schema artifact under `store/curated/<dataset_id>/<resource_id>/`, attaches extracted entities, materializes cross-dataset links through shared entities, and produces machine-generated BG→EN translations of titles and descriptions — every enrichment carrying provenance + confidence (FR-008–FR-011, FR-019, FR-019a–FR-019d). Re-curates without re-fetching from the portal (FR-011).

**Independent Test**: Pick a sample of captured datasets covering tabular (CSV in CP1251 + UTF-8), JSON, GeoJSON, XML formats. After `danni curate`, each has a curated artifact validating against `contracts/curated-tabular-artifact.schema.json` (or the matching schema for JSON/GeoJSON), with declared schema, UTF-8 bytes, normalized dates/numbers, attached `entities` rows, at least one `dataset_links` row when two datasets share a publishing organization, and a `translations` row per title and description. Re-running `danni curate` against the same store does not call the portal (assert no HTTP egress).

### Migrations (US2)

- [ ] T065 [US2] Author migration `migrations/002_curate_enrich.sql` creating `curated_artifacts`, `entities`, `dataset_entities`, `dataset_links`, `translations`, `embeddings_meta` (single-row stub) per `data-model.md` §1.6–§1.9, §1.11, §3.3; include all CHECK constraints and the `dataset_a_id < dataset_b_id` invariant.

### Curator framework (US2)

- [ ] T066 [P] [US2] Define curator interface in `src/curate/curator.ts`: `Curator { kind: ArtifactKind; canHandle(resource): boolean; curate(resource, rawPath): Promise<CuratedArtifact> }`; emits `transformRules` log per FR-009.
- [ ] T067 [P] [US2] Implement format sniffer in `src/curate/sniff.ts`: byte-magic + extension + declared content-type fallback chain; resolves the redirect/wrong-content-type edge case from spec.
- [ ] T068 [P] [US2] Implement encoding detector in `src/curate/encoding.ts`: BOM-first, then chardet-style heuristic for CP1251 vs UTF-8, then declared charset; emits a `transformRules` entry recording the choice.
- [ ] T069 [P] [US2] Implement number/date normalizer in `src/curate/normalize.ts`: ISO-8601 dates, Bulgarian-month dates (`януари`–`декември`), thousand-separator and decimal-comma numerics; records ambiguous-column note per FR-009 edge case.
- [ ] T070 [P] [US2] Implement schema declarer in `src/curate/schema.ts`: infer per-column type for tabular (string|integer|number|boolean|date|datetime), root-shape for JSON/GeoJSON; output conforming to `contracts/curated-tabular-artifact.schema.json#/$defs/Schema`.

### Per-format curators (US2)

- [ ] T071 [P] [US2] CSV curator in `src/curate/csv.ts` (delimiter sniff, header row, T068 encoding, T069 normalize, T070 declare) → emits `data.ndjson` + `schema.json` under `store/curated/<dataset_id>/<resource_id>/`.
- [ ] T072 [P] [US2] JSON curator in `src/curate/json.ts` → emits `data.json` + `schema.json`.
- [ ] T073 [P] [US2] XLSX curator in `src/curate/xlsx.ts` (one artifact per sheet) → emits `data.ndjson` + `schema.json` per sheet under a sheet-named subdir.
- [ ] T074 [P] [US2] GeoJSON curator in `src/curate/geojson.ts` (validates FeatureCollection / Feature root) → emits `data.json` + `schema.json`.
- [ ] T075 [P] [US2] XML curator in `src/curate/xml.ts` (best-effort tabular flattening or hierarchical retention) → emits `data.json` + `schema.json`.
- [ ] T076 [P] [US2] Text-fallback curator in `src/curate/text.ts`: emits `data.txt` (UTF-8) + `schema.json` declaring opaque text.
- [ ] T077 [US2] Uncurated marker in `src/curate/uncurated.ts`: when no curator confidently handles a resource, write a `kind='uncurated'` row with reason; raw bytes retained (FR-010).
- [ ] T078 [US2] Curator registry in `src/curate/registry.ts` composing T071–T076 + T077 fallback; selects via T067 sniff. Depends on T066–T076.

### Entity extraction + cross-dataset linking (US2)

- [ ] T079 [P] [US2] Bulgarian admin gazetteer in `src/enrich/gazetteer/bg-admin.ts`: 28 oblasts + ~265 municipalities with canonical labels (BG + EN), aliases, and ISO 3166-2 codes; canonicalized IDs `geo:bg-municipality-<slug>` / `geo:bg-oblast-<slug>`.
- [ ] T080 [P] [US2] Define extractor interface in `src/enrich/extractor.ts`: `Extractor { id; extract(curatedDataset): Promise<EntityCandidate[]> }`; output carries `evidence` + `confidence` per FR-019d.
- [ ] T081 [P] [US2] Extractor `ckan_organization` in `src/enrich/extractors/ckan-organization.ts` (confidence 1.0).
- [ ] T082 [P] [US2] Extractor `ckan_groups` in `src/enrich/extractors/ckan-groups.ts` (confidence 1.0).
- [ ] T083 [P] [US2] Extractor `ckan_tags` in `src/enrich/extractors/ckan-tags.ts` (confidence 0.6).
- [ ] T084 [P] [US2] Extractor `bg_admin_gazetteer` in `src/enrich/extractors/bg-admin-gazetteer.ts` over titles, descriptions, and string column values; uses T079 (confidence 0.7–0.95 by match exactness).
- [ ] T085 [P] [US2] Extractor `iso8601_dates` in `src/enrich/extractors/iso8601-dates.ts` (confidence 0.95).
- [ ] T086 [P] [US2] Extractor `bg_month_dates` in `src/enrich/extractors/bg-month-dates.ts` (confidence 0.85).
- [ ] T087 [P] [US2] Extractor `column_name_heuristics` in `src/enrich/extractors/column-name-heuristics.ts` (confidence 0.5–0.8).
- [ ] T088 [US2] Entity registrar in `src/enrich/register-entities.ts`: dedupe candidates by canonical id, persist into `entities` + `dataset_entities` (one row per `(dataset_id, entity_id, extractor)`), preserves multiple candidates for ambiguous matches per spec edge case. Depends on T080–T087.
- [ ] T089 [US2] Cross-dataset linker in `src/enrich/link-datasets.ts`: for every shared `entity_id` across two datasets emit a `dataset_links` row with deterministic ordering (`dataset_a_id < dataset_b_id`), `heuristic` and `confidence` per `data-model.md` §1.8, FR-019b. Depends on T088.

### Translation (US2)

- [ ] T090 [P] [US2] Define translator interface in `src/enrich/translator.ts`: `Translator { id; translate(text, src, tgt): Promise<{text, confidence}> }`.
- [ ] T091 [P] [US2] `local-marianmt` translator in `src/enrich/translators/local-marianmt.ts` (R4) loading the BG→EN MarianMT ONNX model from `vendor/models/`; CPU-only batch translate; deterministic confidence heuristic.
- [ ] T092 [P] [US2] `hosted-api` translator in `src/enrich/translators/hosted-api.ts` (R4): POSTs `{text, source:'bg', target:'en'}`; bearer auth; respects `endpointUrl`/`apiKeyEnv` from config.
- [ ] T093 [US2] Translation pipeline in `src/enrich/translate.ts`: for every active dataset's `title_bg`/`description_bg` (and resource descriptions), upsert into `translations` keyed on `(subject_kind, subject_id, translator)`; never writes empty over a prior non-empty unless explicitly forced; preserves the original (Principle X, FR-019c). Depends on T090, T091, T092.

### Curation orchestrator + CLI (US2)

- [ ] T094 [US2] Curate orchestrator in `src/curate/run-curate.ts`: iterates active resources (or filtered by `--datasets`/`--since`), invokes T078, persists `curated_artifacts` row + writes files under `store/curated/`, then runs T088, T089, T093; idempotent re-run when `curator_version` unchanged. Depends on T065, T078, T088, T089, T093.
- [ ] T095 [US2] Implement `danni curate` in `src/cli/curate.ts` per `contracts/cli.md` (`--datasets`, `--since`, `--curator-version`); dispatches to T094. Depends on T094, T017.
- [ ] T096 [US2] Implement `danni mirror-info <dataset_id>` in `src/cli/mirror-info.ts` per `contracts/cli.md`: composes a `curated-dataset.schema.json`-conforming record by joining `datasets`, `resources`, `curated_artifacts`, `dataset_entities`, `dataset_links`, `translations`; supports `--json`. Depends on T094.

### Tests for User Story 2

- [ ] T097 [P] [US2] Contract test in `tests/contract/curated-dataset.test.ts`: `danni mirror-info --json` output validates against `contracts/curated-dataset.schema.json`.
- [ ] T098 [P] [US2] Contract test in `tests/contract/curated-tabular-artifact.test.ts`: each tabular `data.ndjson` + `schema.json` validates against `contracts/curated-tabular-artifact.schema.json`. Each fixture entry recorded in `tests/parity-matrix.json#datasetSchemas` (Constitution VIII).
- [ ] T099 [P] [US2] Unit tests for curator framework primitives in `tests/unit/curate/{sniff,encoding,normalize,schema,registry,uncurated}.test.ts`.
- [ ] T100 [P] [US2] Unit tests per format curator in `tests/unit/curate/{csv,json,xlsx,geojson,xml,text}.test.ts` over `tests/fixtures/resources/*` — assert UTF-8 output, declared schema, transform-rules trace, Cyrillic byte-preservation invariant (Principle X, SC-003).
- [ ] T101 [P] [US2] Unit tests per extractor in `tests/unit/enrich/extractors/{ckan-organization,ckan-groups,ckan-tags,bg-admin-gazetteer,iso8601-dates,bg-month-dates,column-name-heuristics}.test.ts`.
- [ ] T102 [P] [US2] Unit tests for entity registrar + linker in `tests/unit/enrich/{register-entities,link-datasets}.test.ts` — dedupe across extractors, undirected-pair invariant, ambiguous-candidates retained.
- [ ] T103 [P] [US2] Unit tests for translators in `tests/unit/enrich/translators/{local-marianmt,hosted-api,translate}.test.ts` — original Bulgarian never replaced, low-confidence case retains original (FR-019c, SC-010).
- [ ] T104 [US2] Integration test: full curate cycle in `tests/integration/curate-cycle.test.ts` over a multi-format fixture set — every resource gets a curated artifact (or `uncurated` row + reason), entities + links persisted, translations stored, no portal HTTP calls (FR-011).
- [ ] T105 [US2] Integration test: re-curation idempotence in `tests/integration/curate-idempotent.test.ts` — second `danni curate --curator-version <same>` is a no-op; bumping `--curator-version` re-runs and writes a new `curated_artifacts` row keyed on the new version.
- [ ] T106 [US2] Integration test: enrichment guarantees in `tests/integration/enrichment-guarantees.test.ts` — ≥90% of curated datasets carry ≥1 entity (SC-009); ≥95% have a non-empty English title translation with original BG preserved byte-exact (SC-010); querying by a known municipality recovers every dataset linked to it (SC-011).

**Checkpoint**: `danni curate` produces curated artifacts validating against the JSON Schemas in `contracts/`; entities/links/translations rows present; coverage gate green over US2 modules.

---

## Phase 5: User Story 3 — Index optimized for machine reading and retrieval (Priority: P2)

**Goal**: `danni index` builds an FTS5 + sqlite-vec index over the curated mirror enabling keyword + semantic retrieval across BG and EN content; updates incrementally on re-sync (FR-015); `danni search` returns ranked dataset pointers each linking to the curated artifact and source URL (FR-013, SC-004, SC-005, SC-007).

**Independent Test**: After indexing a curated mirror, `danni search "общини бюджет" --lang bg` and `danni search "municipal budgets" --lang en` both return the same top dataset within rank 5; every result conforms to `contracts/index-entry.schema.json` and includes `sourceUrl` + `curatedDatasetPath`. Querying by a known entity (e.g. a municipality canonical id) returns every dataset linked to it (SC-011 — joint with US2 enrichment).

### Migrations (US3)

- [ ] T107 [US3] Author migration `migrations/003_index.sql` creating the FTS5 virtual table `datasets_fts` with `tokenize='unicode61 remove_diacritics 0'` (Principle X) and the `sqlite-vec` virtual table `dataset_embeddings` per `data-model.md` §3.1–§3.2; populate `embeddings_meta` defaults.

### Embedder (US3)

- [ ] T108 [P] [US3] Define embedder interface in `src/index/embedder.ts`: `Embedder { id; dimension; embed(texts: string[]): Promise<Float32Array[]> }` (R3).
- [ ] T109 [P] [US3] `local-onnx` embedder in `src/index/embedders/local-onnx.ts`: loads a multilingual sentence-embedding ONNX model from `vendor/models/`; batches inputs; CPU-only.
- [ ] T110 [P] [US3] `hosted-api` embedder in `src/index/embedders/hosted-api.ts`: POSTs to an OpenAI-compatible `/v1/embeddings` endpoint with bearer auth.

### Index builders (US3)

- [ ] T111 [P] [US3] FTS5 builder in `src/index/fts.ts`: composes FTS row from `(title_bg, title_en, description_bg, description_en, publisher_label, tag_labels, group_labels, column_labels, entity_labels)` for one dataset; upserts on change; supports `--full` rebuild.
- [ ] T112 [P] [US3] Vector builder in `src/index/vec.ts`: composes embedding source text per `data-model.md` §3.2; calls T108–T110; upserts into `dataset_embeddings`; on embedder model change rebuilds incrementally and updates `embeddings_meta`.
- [ ] T113 [US3] Index orchestrator in `src/index/run-index.ts`: iterates active datasets (or `--datasets`); calls T111 + T112; supports `--full`. Depends on T107, T111, T112.
- [ ] T114 [US3] Wire incremental index update into the sync orchestrator: after a Sync Run touches a dataset, schedule an index update for that dataset_id (FR-015, SC-007). Modifies `src/crawler/run-sync.ts`. Depends on T044, T113.

### Search (US3)

- [ ] T115 [P] [US3] Query planner in `src/index/query.ts`: detects language hint (auto/bg/en), executes FTS5 + vector query, fuses scores (e.g. weighted reciprocal-rank-fusion), maps to `contracts/index-entry.schema.json` records each carrying `sourceUrl` (back to `datasets.source_url`) and `curatedDatasetPath` (FR-013).
- [ ] T116 [US3] Implement `danni search` in `src/cli/search.ts` per `contracts/cli.md` (`--lang`, `--limit`, `--json`); dispatches to T115. Depends on T115, T017.
- [ ] T117 [US3] Implement `danni index` in `src/cli/index.ts` per `contracts/cli.md` (`--full`, `--datasets`); dispatches to T113. Depends on T113, T017.

### Tests for User Story 3

- [ ] T118 [P] [US3] Contract test in `tests/contract/index-entry.test.ts`: `danni search --json` records validate against `contracts/index-entry.schema.json`.
- [ ] T119 [P] [US3] Unit tests for embedders in `tests/unit/index/embedders/{local-onnx,hosted-api}.test.ts` — dimension consistency, deterministic batching, hosted error mapping.
- [ ] T120 [P] [US3] Unit tests for builders in `tests/unit/index/{fts,vec,query,run-index}.test.ts` — FTS Cyrillic preservation (Principle X), vector upsert idempotence, query fusion ordering.
- [ ] T121 [US3] Integration test: cross-language retrieval in `tests/integration/search-cross-lang.test.ts` — same dataset returned in top-5 for BG and EN queries against a curated fixture (FR-014, SC-004).
- [ ] T122 [US3] Integration test: incremental index in `tests/integration/index-incremental.test.ts` — second sync that mutates one dataset triggers an index update for that dataset only; full corpus is not re-embedded; new content surfaces in next search (FR-015, SC-007).
- [ ] T123 [US3] Integration test: entity-anchored recall in `tests/integration/search-by-entity.test.ts` — querying by a known municipality entity_id recovers every linked dataset (SC-011).
- [ ] T124 [US3] Integration test: result traceability in `tests/integration/search-traceability.test.ts` — every result includes a non-empty `sourceUrl` resolving back to data.egov.bg and a `curatedDatasetPath` pointing at an existing file on disk (FR-013, SC-005).

**Checkpoint**: `danni search` returns ranked, schema-conforming results for BG + EN queries; coverage gate green over US3 modules.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Performance, documentation, and final gates spanning all stories.

- [ ] T125 [P] Live-portal smoke task documentation in `specs/portal-api/scale.md`: instructions to run a one-shot live discovery, record observed dataset/resource counts and total bytes (R8); committed only after operator-run, not gating CI.
- [ ] T126 [P] Bootstrap-window perf check in `tests/integration/perf-resync.test.ts` against the largest fixture set: re-sync wall time < 10% of bootstrap wall time (SC-002).
- [ ] T127 [P] Vitest unit-suite budget check in `tests/integration/perf-unit-suite.test.ts`: assert `bun run test --run` over `tests/unit/` completes in < 5s (Constitution VI).
- [ ] T128 [P] Search latency check in `tests/integration/perf-search.test.ts`: top-5 retrieval < 1s on the curated fixture corpus.
- [ ] T129 [P] Run quickstart validation script in `tests/integration/quickstart.test.ts`: shells through every numbered step in `specs/001-egov-data-sync/quickstart.md` against fixtures and asserts each artifact appears as documented.
- [ ] T130 [P] Constitution-gate test in `tests/integration/constitution-gates.test.ts`: asserts (a) every consumed CKAN endpoint listed in `specs/portal-api/` has a contract test ID in `tests/parity-matrix.json#endpoints`, (b) every dataset-schema entry in `specs/dataset-schemas/` has a parity-test ID in `tests/parity-matrix.json#datasetSchemas` (Constitution III, VIII).
- [ ] T131 [P] Fill out `specs/dataset-schemas/README.md` + per-format catalog stubs (`specs/dataset-schemas/{tabular,json,geojson,xml}.md`) describing the curated schema contract per kind; one entry per fixture in `tests/fixtures/resources/`.
- [ ] T132 [P] Project README rewrite in `README.md`: capabilities, status (v1 = data pipeline; MCP follow-up), pointers to plan/spec/quickstart, single-paragraph install + run, license.
- [ ] T133 Final coverage audit: `bun run test --coverage` reports 100% line + 100% branch across `src/` (Constitution VIII); resolve any remaining gaps before tagging v0.1.0.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** → no dependencies; T002–T009 parallel after T001.
- **Phase 2 (Foundational)** → blocks every user story. T010 ⟶ T012; T013 ⟶ many; T014–T015 ⟶ T016 ⟶ T017–T018; tests T019–T023 parallel; parity-matrix file T024 parallel.
- **Phase 3 (US1)** → starts after Phase 2.
- **Phase 4 (US2)** → starts after Phase 2 (does **not** require US1 implementation, only the `datasets`/`resources`/`organizations` rows that Phase 2 migrations + foundational repositories create — fixtures populate them in unit/integration tests).
- **Phase 5 (US3)** → starts after Phase 2 (uses curated rows in production, but tests use fixtures so US3 unit tests do not block on US2 implementation).
- **Phase 6 (Polish)** → starts after the user stories selected for the cut are complete.

### Inter-Story Notes

- US1, US2, and US3 are **independently testable** against fixtures. In production runtime the data flow is sync → curate → enrich → index, but the test pyramid is decoupled.
- T114 wires US1 → US3 incremental index updates. It must follow T044 (US1) and T113 (US3) but can be implemented as the very last task of US3.
- SC-011 (entity-anchored recall) is jointly verified by T106 (US2) and T123 (US3); both must pass.

### Parallel Opportunities

- **Phase 1**: T002–T009 in parallel after T001.
- **Phase 2**: T013, T019, T020, T021, T022, T023, T024 in parallel; T011 in parallel with T013.
- **US1**: T026, T027, T028, T029, T030, T031, T034, T035, T036, T038, T047 all parallel; tests T051–T059 all parallel.
- **US2**: T066–T070 parallel; T071–T076 (per-format curators) parallel; T079–T087 (extractors + gazetteer) parallel; T090–T092 (translator providers) parallel; tests T097–T103 parallel.
- **US3**: T108–T110 (embedders) parallel; T111–T112 parallel; tests T118–T120 parallel.
- **Polish**: T125–T132 all parallel; T133 last.

### Within Each User Story

- Tests and implementation files are split — tests use fixtures committed in T026/T027 plus the contract files in `contracts/`.
- Migrations come before repositories; repositories before orchestrators; orchestrators before CLI commands; CLI commands before integration tests of those commands.

---

## Parallel Example: User Story 1 — crawler primitives

```bash
# After Phase 2 (foundational) is green, fan these out:
Task: "T026 [US1] Capture portal fixtures under tests/fixtures/portal/"
Task: "T027 [US1] Capture sample raw resource bytes under tests/fixtures/resources/"
Task: "T028 [US1] Implement Zod schemas in src/crawler/ckan-schema.ts"
Task: "T029 [US1] Implement rate limiter in src/crawler/rate-limit.ts"
Task: "T030 [US1] Implement backoff in src/crawler/backoff.ts"
Task: "T031 [US1] Implement robots.txt cache in src/crawler/robots.ts"
Task: "T034 [US1] Implement blob store in src/store/blob-store.ts"
Task: "T035 [US1] Implement repositories in src/store/repos/*"
Task: "T036 [US1] Implement manifest writer in src/manifest/writer.ts"
Task: "T038 [US1] Implement scope filter in src/crawler/scope.ts"
Task: "T047 [US1] Implement notifier providers in src/notify/*"
```

## Parallel Example: User Story 2 — extractors

```bash
# After T079 (gazetteer) and T080 (interface), fan out:
Task: "T081 [US2] Extractor ckan_organization in src/enrich/extractors/ckan-organization.ts"
Task: "T082 [US2] Extractor ckan_groups in src/enrich/extractors/ckan-groups.ts"
Task: "T083 [US2] Extractor ckan_tags in src/enrich/extractors/ckan-tags.ts"
Task: "T084 [US2] Extractor bg_admin_gazetteer in src/enrich/extractors/bg-admin-gazetteer.ts"
Task: "T085 [US2] Extractor iso8601_dates in src/enrich/extractors/iso8601-dates.ts"
Task: "T086 [US2] Extractor bg_month_dates in src/enrich/extractors/bg-month-dates.ts"
Task: "T087 [US2] Extractor column_name_heuristics in src/enrich/extractors/column-name-heuristics.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (Setup) → 2. Phase 2 (Foundational) → 3. Phase 3 (US1).
2. **Stop and validate**: run `danni sync` + `danni status` against a narrow scope; manifest validates; coverage 100% over US1 modules; constitution gates pass.
3. This is shippable as a v0.1 byte-faithful local mirror with audit trail. The portal already gets respectful traffic.

### Incremental Delivery

1. MVP (US1) → demo/deploy.
2. Add US2 (curate + enrich) → curated artifacts under `store/curated/` validate against `curated-tabular-artifact.schema.json` / `curated-dataset.schema.json`; demo via `danni mirror-info --json`.
3. Add US3 (index) → `danni search` returns BG + EN results; wire T114 so re-syncs keep the index fresh.
4. Polish (Phase 6) → live-portal scale capture, perf checks, parity matrix audit, README.

### Parallel Team Strategy

After Phase 2 closes:

- Track A: US1 crawler + capture + scheduler.
- Track B: US2 curator framework + extractors + translators (uses fixtures, independent of Track A's progress).
- Track C: US3 embedder + index builders + search (uses curated fixtures).
- Tracks rendezvous at T114 (sync→index wiring) and Phase 6.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in the same phase.
- [Story] label maps each task to its user story; setup, foundational, and polish phases carry no story label.
- Tests are mandatory (Constitution VIII). Each module-implementation task in `src/` has a corresponding unit test in `tests/unit/`; integration tests live in `tests/integration/`; contract tests live in `tests/contract/` and are recorded in `tests/parity-matrix.json`.
- Cyrillic preservation (Principle X) is asserted in unit tests for `cyrillic.ts`, every per-format curator, FTS builder, and the index round-trip.
- Authoritative-field immutability (Principle X) is asserted in repositories' tests (`dataset_revisions` row appears on change; the original `title_bg`/`description_bg` is never overwritten by a translation row).
- Commit after each task or logical group; stop at any phase checkpoint to run `bun run test --coverage` and validate the constitution gates before proceeding.
