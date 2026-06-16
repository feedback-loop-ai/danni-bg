# Implementation Plan: Entities-only curate mode (re-extract without re-parsing)

**Branch**: `feat/curate-entities-only` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/015-entities-only-curate/spec.md`
**Status**: Implemented (shipped via PR #20, merged 2026-06-16; verified by the test suite — 987 pass / 0 fail)

## Summary

A full `danni curate` re-parses every captured resource into memory before attaching
entities; on the ~16k-resource live mirror this hit >20 GB RSS and was OOM-killed mid-run
while materializing the publisher-region recall (#19), leaving an inconsistent partial state.
But entity extraction reads dataset/resource **metadata rows**, not the parsed artifacts — so
the parse is pure waste when only an extractor or the gazetteer changed.

This feature adds an **entities-only mode** — `runCurate({ entitiesOnly: true })` and the CLI
flag `danni curate --entities-only` — that re-runs only the extractors, cross-dataset linking,
and entity-relation materialization, **skipping** the resource-parse loop (the memory hog) and
translation (which needs the LAN translator). It is the cheap, low-memory (~140 MB RSS) way to
refresh entities after an extractor/gazetteer change; its `dataset_entities` / `dataset_links` /
`entity_relations` writes are idempotent (PK-guarded `INSERT OR REPLACE`), so it is safe to
re-run over the whole catalog.

The change is small and surgical: an `entitiesOnly?: boolean` option on `RunCurateOptions`
that (a) `break`s out of the per-resource parse loop before any file is read, and (b) guards the
translation block; and a `--entities-only` CLI flag that sets it and skips constructing the
translator. It also corrects the publisher-extractor ordering comments to reflect the real
data model: `dataset_entities`' PK includes the extractor, so a place matched both in-content
and via publisher keeps **a row per extractor**, and the read layer takes the **max confidence**
per `(dataset, entity)` — the stronger in-content match wins downstream, not via an overwrite
between extractors. No schema change, no new migration, no new external contract beyond the flag.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, no `any` outside type guards) — unchanged from 001.
**Primary Dependencies**:
- Runtime: Bun 1.x with `bun:sqlite` (existing `openDb` in `src/store/db.ts`).
- Curate path: existing `CuratorRegistry`, the registered extractors
  (`CkanOrganizationExtractor`, `CkanGroupsExtractor`, `CkanTagsExtractor`,
  `BgAdminPublisherExtractor`, `BgAdminGazetteerExtractor`, `Iso8601DatesExtractor`,
  `BgMonthDatesExtractor`, `ColumnNameHeuristicsExtractor`), `registerEntities`,
  `linkAllSharedEntities`, `registerEntityRelations`, `translateSubjects` — composed, not changed.
- Repos: existing `DatasetsRepo`, `ResourcesRepo`, `OrganizationsRepo`, `EntitiesRepo`,
  `DatasetLinksRepo`, `EntityRelationsRepo`, `CuratedArtifactsRepo`, `TranslationsRepo`.
- Translators (CLI only): `LocalMarianMtTranslator`, `HostedApiTranslator` — NOT constructed in
  entities-only mode.
- Testing: `bun test` (per 001's Complexity Tracking decision: Vitest hangs under Bun with `bun:sqlite`).
- Lint/Format: Biome.

**Storage**: **No new table, no new migration, no on-disk layout change.** Entities-only writes
to the same `dataset_entities` / `dataset_links` / `entity_relations` tables a full run writes;
it simply does not write `curated_artifacts` or `translations`. All writes are PK-guarded
`INSERT OR REPLACE` upserts, so re-running is idempotent.

**Testing**: `bun test` against a temp SQLite store. The new unit test seeds a captured,
parse-able resource (which a full run WOULD parse), runs `runCurate({ entitiesOnly: true })`
with a translator supplied, and asserts: zero artifacts of either kind, zero translations, but
entities attached including the publisher-derived place (`geo:bg-municipality-stolichna`).

**Target Platform**: Linux server / macOS dev — unchanged from 001. Notably, entities-only is
runnable on hosts with **no LAN access** to the translation backend (a deliberate goal, US2).

**Project Type**: Single project — CLI + library. The work is confined to `src/curate/run-curate.ts`,
`src/cli/curate.ts`, and a comment correction in `src/enrich/extractors/bg-admin-publisher.ts`.

**Performance Goals**: The defining goal is memory, not throughput. Full curate ≈20 GB RSS on
the live mirror (OOM-killed); entities-only ≈140 MB RSS, completing the full catalog. Entities-only
also avoids all translation I/O (no LAN round-trips).

**Constraints**:
- 100% line + branch coverage (Principle VIII): the new `entitiesOnly` branch in the resource
  loop (`break`) and in the translation guard (`opts.translator && !opts.entitiesOnly`) are both
  exercised by the new test plus the existing full-run and no-translator tests.
- Cyrillic preserved byte-exact (Principle X): entities-only attaches the same Cyrillic-derived
  place entities; the test asserts on `geo:bg-municipality-stolichna` from the `Столична община`
  publisher.
- Idempotency: re-running MUST NOT duplicate rows (FR-006) — guaranteed by the PK-guarded upserts.

**Scale/Scope**: One option flag + one CLI flag + a comment correction. No schema, no migration,
no external contract change beyond the documented `--entities-only` flag.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence in this plan |
|---|-----------|--------|------------------------|
| I | AI-Native Development (NON-NEGOTIABLE) | ✅ PASS | Entities-only refreshes *derived* dataset→entity edges from metadata; it mutates no authoritative portal data and produces the same machine-readable `RunCurateResult`. It makes the entity layer the AI agents read *correct* (the recall #19 needed) without re-deriving anything else. |
| II | Spec-Driven Development (SDD) | ✅ PASS | spec.md (WHAT — three user stories) → this plan + research.md (HOW) → tasks.md → `bun test` (VALIDATION). Roles are kept distinct in the artifacts. |
| III | Contract-First API Design | ✅ PASS | No new MCP tool, no new portal endpoint. The CLI contract gains exactly one flag (`--entities-only`), documented in `contracts/cli.md` before/with the code. `RunCurateResult` shape is unchanged. |
| IV | Operational Excellence (NON-NEGOTIABLE in spirit) | ✅ PASS | The mode turns an OOM-killed, partial-state operation into a bounded-memory one that runs to completion; it logs the same `curate.completed` structured record. No sensitive data logged. |
| V | Simplicity & YAGNI | ✅ PASS | The minimal change that solves the OOM: one boolean option guarding the parse loop (`break`) and the translation block, plus one CLI flag that skips constructing the translator. No new module, no new config, no new table. Re-parsing was the cited waste; the fix removes exactly it. |
| VI | Fast Feedback Loops (NON-NEGOTIABLE) | ✅ PASS | The new unit test runs offline against a temp SQLite store with an injected deterministic translator — no network, no LAN, no live model. `bun test` stays fast. |
| VII | Type Safety & Validation (NON-NEGOTIABLE) | ✅ PASS | `entitiesOnly?: boolean` is a typed option on `RunCurateOptions`; the CLI flag is parsed into the typed `CurateFlags`. No `any`, no new JSON columns, no schema. The CLI's spread (`flags.entitiesOnly ? { entitiesOnly: true } : { translator }`) keeps the option mutually exclusive with translator construction at the type level. |
| VIII | 100% Test Coverage & Endpoint Parity (NON-NEGOTIABLE) | ✅ PASS | The new branch (parse-loop `break`; translation guard) is covered by the new `--entities-only` test, which asserts no artifacts, no translations, and a populated entity (incl. the publisher-derived place); the existing full-run + no-translator tests cover the other arms. No new endpoint → parity matrix unaffected. Suite: 987 pass / 0 fail. |
| IX | Data Freshness & Sync Integrity (NON-NEGOTIABLE) | ✅ PASS | Entities-only reads metadata rows already in the mirror and re-asserts derived edges; it neither alters `last_synced_at`/`source_etag_or_hash` nor touches captured raw content. It *restores* integrity by letting the recall finish cleanly instead of leaving an OOM-killed partial state. |
| X | Bulgarian-Locale Awareness | ✅ PASS | The Cyrillic publisher name (`Столична община`) flows through the publisher extractor to `geo:bg-municipality-stolichna` byte-exact; the test asserts on it. No authoritative field is rewritten; translation (the only EN-deriving step) is *skipped*, leaving prior translations intact. |
| XI | Respectful Crawling (NON-NEGOTIABLE) | ✅ PASS | Entities-only performs no network I/O at all — it neither crawls the portal nor calls the translation backend. It is strictly a local re-derivation over the existing mirror. |

**Result**: All gates PASS. No new Complexity Tracking entries beyond the inherited `bun test`
decision (001). No constitution violations.

## Project Structure

### Documentation (this feature)

```text
specs/015-entities-only-curate/
├── plan.md              # This file
├── research.md          # Phase 0 output (R1–R4): OOM diagnosis, why re-parse is unnecessary, idempotency, no-migration
├── data-model.md        # What curate writes: curated_artifacts/translations (skipped) vs dataset_entities/dataset_links/entity_relations (re-asserted)
├── quickstart.md        # `danni curate --entities-only` usage + when to use it
├── contracts/
│   └── cli.md           # The added `--entities-only` flag on `danni curate`
├── checklists/
│   └── requirements.md  # Spec quality checklist
├── spec.md
└── tasks.md             # Created by /speckit-tasks
```

A `contracts/` directory IS present here (unlike 002/003/005) because the feature changes the
**CLI contract** — it adds the `--entities-only` flag to `danni curate`. The flag is documented
in `contracts/cli.md`, matching the CLI-contract convention established in
`specs/001-egov-data-sync/contracts/cli.md`. No JSON schema, no MCP tool, no portal endpoint is
added.

### Source Code (repository root)

Files **modified** (no files added):

```text
src/curate/run-curate.ts                    # Add entitiesOnly?: boolean to RunCurateOptions;
                                            #   `break` the per-resource parse loop when set;
                                            #   guard the translation block (translator && !entitiesOnly)
src/cli/curate.ts                           # Add --entities-only flag → CurateFlags.entitiesOnly;
                                            #   when set, pass { entitiesOnly: true } and DO NOT
                                            #   build a translator (else build translator as before);
                                            #   update --help usage line
src/enrich/extractors/bg-admin-publisher.ts # Correct the ordering comment: dataset_entities keeps
                                            #   a row per extractor (PK includes extractor); the read
                                            #   layer takes max confidence per (dataset, entity) — not
                                            #   an INSERT OR REPLACE overwrite between extractors
```

Tests **modified**:

```text
tests/unit/curate/run-curate.test.ts        # New test: --entities-only re-extracts entities (incl.
                                            #   the publisher-derived place) WITHOUT parsing resources
                                            #   or translating, even when a translator is supplied
```

Files **read but not modified** (depended upon):

```text
src/curate/registry.ts                                   # CuratorRegistry.curate (the parse skipped in entities-only)
src/enrich/register-entities.ts                          # registerEntities (runs in both modes)
src/enrich/link-datasets.ts                              # linkAllSharedEntities (runs in both modes)
src/enrich/relations/register-relations.ts               # registerEntityRelations (runs in both modes)
src/enrich/translate.ts                                  # translateSubjects (skipped in entities-only)
src/enrich/extractors/*.ts                               # the registered extractors (read metadata, not artifacts)
src/store/repos/{datasets,resources,organizations,entities,dataset-links,entity-relations,curated-artifacts,translations}.ts
migrations/002_curate_enrich.sql, migrations/007_entity_relations.sql  # PK-guarded upsert targets
```

**Structure Decision**: Single-project layout (inherited from 001). The change lives where the
behavior is owned — the curate orchestrator (`run-curate.ts`) gates the two expensive steps, and
the CLI (`curate.ts`) parses the flag and decides not to construct a translator. No new module
and no new directory: the mode is a guarded subset of the existing curate pipeline, which is the
whole point (re-use the linking/relation/extraction code, skip the parse + translate).

## Complexity Tracking

> No constitution violations. No entries required.

The only inherited Complexity Tracking item is the project-wide `bun test` runner decision
(recorded in 001), which this feature does not change.
