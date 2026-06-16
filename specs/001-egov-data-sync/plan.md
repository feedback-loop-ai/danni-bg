# Implementation Plan: Local Sync of data.egov.bg with Curation and Machine-Readable Index

**Branch**: `001-egov-data-sync` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-egov-data-sync/spec.md`

## Summary

Build a single-machine pipeline that (1) discovers and downloads every dataset on
[data.egov.bg](https://data.egov.bg/) (CKAN-style portal) into a byte-faithful local mirror,
(2) curates each captured resource into a normalized, declared-schema, UTF-8 artifact and
enriches it with extracted entities, cross-dataset links, and machine-translated English
title/description (original Bulgarian preserved unchanged), and (3) indexes the curated
mirror for keyword + semantic retrieval over Cyrillic and English content. The pipeline
runs on a configurable schedule with single-run locking, an audit trail of Sync Runs, and
conservative respectful-crawler defaults. The store is SQLite (FTS5 + `sqlite-vec`) plus a
flat-file blob layout for raw resources and curated artifacts. The MCP read interface is
explicitly a follow-up feature; this feature delivers the data pipeline that feeds it and
emits machine-readable contracts (manifest, curated-artifact, index-entry) usable directly
by downstream consumers.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, `noUncheckedIndexedAccess`, no `any` outside type guards)
**Primary Dependencies**:
- Runtime: Bun 1.x (native TS, built-in `fetch`, `bun:sqlite`)
- Validation: Zod ^3.25.x at every boundary (CLI args, config file, portal responses, persisted records on read)
- HTTP: Bun `fetch` for portal calls; conditional requests via `If-None-Match` / `If-Modified-Since`; per-host rate limiter + exponential backoff with jitter (homegrown thin wrapper — no heavyweight HTTP framework)
- Local store: `bun:sqlite` with FTS5 (`unicode61` tokenizer, `remove_diacritics 0`) for keyword + Cyrillic search; `sqlite-vec` extension for semantic similarity over curated text
- Migrations: forward-only SQL files in `migrations/`, applied via a tiny in-house runner that records applied versions in a `schema_migrations` table (no extra dep)
- Embeddings: multilingual sentence embedder (decision deferred to research.md — local ONNX vs. hosted API)
- Translation: BG→EN machine translation provider (decision deferred to research.md — local vs. hosted)
- Entity extraction: rule-based v1 (CKAN `organization` / `groups` / `tags`, Bulgarian gazetteer of municipalities and oblasts, ISO-8601 + Bulgarian-month date parsing) with confidence + provenance; ML extractors are out of scope for v1
- Testing: `bun:test` + `bun test --coverage` (100% line + branch enforced in CI)
- Lint/Format: Biome (single config, pre-commit + CI)

**Storage**:
- SQLite database at `store/danni.sqlite` (transactional, migrated, FTS5 + vec virtual tables)
- Flat-file blob layout under `store/raw/<dataset_id>/<resource_id>/<sha256>.<ext>` (byte-for-byte captures, content-addressable, never rewritten)
- Curated artifacts under `store/curated/<dataset_id>/<resource_id>/<artifact-name>.{ndjson,json}`
- Sync-run manifests under `store/manifest/<run_id>.json`
- Index artifacts (FTS + vec) live inside `store/danni.sqlite`

**Testing**: `bun:test`. Inner dev loop runs against recorded portal fixtures under `tests/fixtures/portal/`; no live-network hit required for unit + integration tests. Live smoke runs against the real portal are gated behind an explicit env var and never required for CI green.

**Target Platform**: Linux server (operator-controlled) with Bun 1.x. macOS dev workstation is supported for local development.

**Project Type**: Single project — CLI + library. The MCP read interface is a deliberate follow-up feature; this plan provisions store + contracts so the MCP layer can be added without re-shaping data on disk.

**Performance Goals**:
- Bootstrap sync of the full portal completes within a single overnight off-peak window (Europe/Sofia) at the configured respectful rate (default ≤ 1 req/s, ≤ 4 concurrent connections); concrete dataset count quantified in research.md
- Re-sync over an unchanged portal completes in < 10% of bootstrap time (SC-002)
- Curation re-run over the existing local mirror does not re-fetch from the portal (FR-011)
- Index query: top-5 retrieval in < 1s on a developer laptop for the full curated corpus
- `bun test` unit suite: < 5s end-to-end (Principle VI)

**Constraints**:
- Respectful crawler: robots.txt honored and re-checked on a configurable cadence; per-host rate limit; identifying User-Agent including project name, version, contact URL/email; conditional requests; exponential backoff with jitter; configurable failure budget; no parallel hammering; no auth bypass (Principle XI)
- 100% line + branch coverage (Principle VIII), enforced in CI
- Cyrillic preserved byte-exact through ingest, store, and index (Principle X)
- Single-process operation; no cluster, no message broker
- All persisted authoritative fields are immutable post-capture; curation and enrichment write to separate fields/tables and never mutate the raw record (Principle X)

**Scale/Scope**:
- Order-of-magnitude estimate (to be confirmed in research.md): ~10⁴ datasets, ~10⁴–10⁵ resources, ~10s–100s GB of raw bytes total. The plan does not assume specific portal scale; sizing is the operator's responsibility per the spec assumptions.
- 30-day operational window for SC-008 (≥ 95% of scheduled runs complete with summary outcome)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence in this plan |
|---|-----------|--------|------------------------|
| I | AI-Native Development | ✅ PASS | Curated artifacts, manifest, and index entries are machine-parseable JSON/NDJSON with declared schemas (contracts/). Raw portal data is retained byte-exact and never altered on the read path. Errors are structured. |
| II | Spec-Driven Development | ✅ PASS | spec.md (WHAT) → this plan (HOW) → tasks.md (next) → tests (VALIDATION). Roles separated in artifacts. |
| III | Contract-First API Design | ✅ PASS | `specs/portal-api/` and `specs/dataset-schemas/` are bootstrapped in Phase 1. `contracts/` defines manifest, curated-artifact, index-entry, sync-run, config schemas before code. CLI command schemas Zod-validated. MCP tools are out of scope here (follow-up feature) — no MCP contract claims are made. |
| IV | Operational Excellence | ✅ PASS | Structured JSON logging per Sync Run; CLI exposes `status` (last sync time, per-component health); failures mapped to documented exit codes; graceful degradation (the local mirror is fully read-usable without network). |
| V | Simplicity & YAGNI | ✅ PASS | SQLite over Postgres; in-process scheduler; no microservices; no message queue; rule-based entity extraction in v1. No invented abstractions on top of CKAN concepts. |
| VI | Fast Feedback Loops | ✅ PASS | Bun + `bun:test` + Biome; recorded portal fixtures eliminate live-network dependency in dev loop. |
| VII | Type Safety & Validation | ✅ PASS | TS strict mode; Zod at CLI, config, portal-response, and persisted-record-load boundaries. |
| VIII | 100% Test Coverage & Endpoint Parity | ✅ PASS | Plan provisions: contract tests per consumed CKAN endpoint; round-trip parity tests per Dataset Schema Catalog entry; `tests/parity-matrix.json` checked in CI. Coverage gate: 100% line + branch. |
| IX | Data Freshness & Sync Integrity | ✅ PASS | Every dataset/resource row carries `last_synced_at` and `source_etag_or_hash`. Withdrawn detection (FR-016) maps to constitution's "tombstone" requirement. In-place title/metadata renames are captured via `dataset_revisions` (data-model §1.10). Cross-identifier republication (same logical dataset under a new portal id) is **deferred to a follow-up feature** — see Complexity Tracking — because it requires semantic dedup beyond what CKAN exposes; v1 treats each portal id as authoritative per the spec assumption. Sync-run audit trail per FR-003 / FR-017a. Freshness block exposed by the read contracts so the future MCP layer can surface it directly. |
| X | Bulgarian-Locale Awareness | ✅ PASS | UTF-8 end-to-end; FTS5 `unicode61` tokenizer (with `remove_diacritics 0` to preserve Cyrillic semantics); original Bulgarian fields immutable; English translations stored in clearly distinct fields with provenance + confidence (FR-019c, FR-019d); test fixtures include Cyrillic. |
| XI | Respectful Crawling | ✅ PASS | robots.txt fetched + honored; per-host rate limit; identifying User-Agent (`danni-bg/<version> (+<contact-url>)`); conditional requests; exponential backoff + jitter; configurable concurrency cap; configurable failure budget. Test suite asserts each of these. |

**Result**: All gates PASS with one explicit deferral recorded in Complexity Tracking (cross-id rename detection, Principle IX).

## Project Structure

### Documentation (this feature)

```text
specs/001-egov-data-sync/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── manifest.schema.json
│   ├── sync-run.schema.json
│   ├── curated-dataset.schema.json
│   ├── curated-tabular-artifact.schema.json
│   ├── index-entry.schema.json
│   ├── config.schema.json
│   └── cli.md
├── spec.md
└── tasks.md             # Created by /speckit-tasks (not by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── cli/                 # CLI entrypoints: sync, curate, index, status, search-debug, schedule
├── crawler/             # Portal client, robots.txt, rate limiter, conditional fetch, backoff
├── store/               # SQLite schema/migrations runner, repositories, blob-store helpers
├── manifest/            # Manifest writer/reader, Sync Run records
├── curate/              # Per-format curators (csv, json, xlsx, geojson, xml, txt-fallback)
├── enrich/              # Entity extractors, cross-dataset linker, BG→EN translator wrapper
├── index/               # FTS5 + sqlite-vec index builders and query helpers
├── schedule/            # In-process scheduler with single-run lock
├── notify/              # Operator notification dispatch (FR-017b)
├── config/              # Config file loader + Zod schema
├── logging/             # Structured JSON logger
└── lib/                 # Shared utilities (cyrillic helpers, hashing, ids, types)

tests/
├── contract/            # Portal API endpoint contract tests + dataset schema parity tests
├── integration/         # End-to-end pipeline tests against recorded fixtures
├── unit/                # Per-module unit tests
├── fixtures/
│   ├── portal/          # Recorded HTTP request/response pairs
│   └── resources/       # Sample raw resource files (incl. Cyrillic)
└── parity-matrix.json   # Maps consumed endpoints + catalog entries to contract tests

specs/
├── portal-api/          # data.egov.bg API Reference Spec (Constitution III)
├── dataset-schemas/     # Per-dataset schema catalog (Constitution III)
└── 001-egov-data-sync/  # This feature

migrations/              # Forward-only SQL migration files (NNN_name.sql)

store/                   # Runtime data (.gitignored except for .gitkeep markers)
├── raw/                 # Byte-faithful captures: raw/<dataset_id>/<resource_id>/<sha256>.<ext>
├── curated/             # Normalized artifacts: curated/<dataset_id>/<resource_id>/<artifact>
├── manifest/            # Sync-run manifests: manifest/<run_id>.json
└── danni.sqlite         # Single durable queryable store (FTS5 + sqlite-vec)
```

**Structure Decision**: Single-project layout. The `src/` tree is organized by pipeline
stage (crawler → store → curate → enrich → index) rather than by layer (model/service/
controller) to mirror the data flow described in the spec and to make per-stage re-runs
trivial (FR-011: re-curate without re-fetch). The MCP read interface, when added in a
follow-up feature, will live under `src/mcp/` and read exclusively from `store/` — it is
deliberately absent here.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Cross-id rename / republication detection deferred to v2 | Constitution IX requires rename detection. CKAN exposes no stable identity beyond `id`; correctly detecting "same logical dataset, new id" requires content-hash + metadata heuristics that are themselves a research item. v1 captures in-place renames via `dataset_revisions`; cross-id republication is recorded as a *new* dataset (per spec assumption) and flagged for v2 reconciliation. | "Best-effort fuzzy match in v1" rejected: false positives would corrupt the audit trail (Principle IX) and silently merge unrelated datasets — worse than deferring. |
| Test runner: `bun:test` (historical note — Vitest was the originally locked choice) | Vitest was originally the constitution-locked runner, but `bun:sqlite` (used by `src/store/db.ts` and every repo) is only resolvable inside the Bun runtime. Vitest's tinypool worker pool relies on Node-specific `worker_threads` semantics and hangs/crashes when run under Bun (`port.addListener is not a function`). `bun:test` was adopted instead — it keeps the constitution's test API surface (describe/it/expect, beforeEach/afterEach), preserves 100%-line/branch coverage enforcement (`bun test --coverage --coverage-threshold=1.0`), and removes the cross-runtime hazard. `bun:test` is now the locked runner per constitution v1.1.1. | "Mock `bun:sqlite` in Vitest" rejected: would require an entire alternative SQLite layer (e.g. `better-sqlite3`) that diverges from production behavior — exactly the mock-vs-prod drift Principle VIII guards against. "Run Vitest under Node and live-test SQLite via subprocess" rejected: doubles the test infrastructure for a workaround. |
