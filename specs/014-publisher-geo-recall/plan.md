# Implementation Plan: Publisher-derived geographic recall (shrink the national bucket)

**Branch**: `014-publisher-geo-recall` | **Date**: 2026-06-15 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/014-publisher-geo-recall/spec.md`

**Note**: Retrospective plan. The work shipped in PR #19 (merged 2026-06-15); this plan documents the as-built approach.

## Summary

Add a second geographic extractor, `BgAdminPublisherExtractor`, to the curation pipeline. It runs the existing Bulgarian administrative gazetteer over the **publishing organisation's name** (`org.title_bg`) and attaches the matched administrative unit to the dataset at a *lower* confidence than an in-content match (0.7 canonical / 0.6 alias vs 0.95 / 0.75), with `evidence.source = 'publisher'`. It is registered *before* the in-content `BgAdminGazetteerExtractor`, and persistence keys attachments by `(dataset_id, entity_id, extractor)` so both provenance rows coexist; the read layer takes the maximum confidence per `(dataset, entity)`. This recovers the large class of municipal/regional datasets whose own metadata names no place — shrinking the non-georeferenced national grouping from 56.7% to 15.0% of the mirror — while composing with the oblast roll-up (feature 013) and never downgrading explicit in-content placements.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Bun 1.x  
**Primary Dependencies**: None new — reuses the existing gazetteer (`src/enrich/gazetteer/bg-admin.ts`), the `Extractor` interface, the `OrganizationsRepo`, and the `EntitiesRepo.attach` upsert  
**Storage**: SQLite mirror (`dataset_entities` table; composite PK `(dataset_id, entity_id, extractor)`)  
**Testing**: `bun test` — unit tests under `tests/unit/enrich/extractors/`, integration under `tests/integration/`  
**Target Platform**: Linux server / CLI (`danni curate`)  
**Project Type**: Single project (CLI + library; map web app consumes the curated store read-only)  
**Performance Goals**: Adds one organisation lookup + one gazetteer scan per dataset during curation; negligible relative to resource parsing. Materializable corpus-wide via `--entities-only` without re-parsing files.  
**Constraints**: Must not downgrade in-content placement confidence; must not manufacture placements for national publishers; must preserve authoritative Bulgarian organisation names byte-exact.  
**Scale/Scope**: Live mirror ≈ 11,854 datasets; ~6,721 previously national, ~4,945 recoverable via publisher name.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against `.specify/memory/constitution.md` v1.1.0:

- **I. AI-Native Development**: PASS. Placement remains a deterministic read over the mirror. The extractor derives a geographic entity from authoritative portal metadata (the organisation name); it does not invent, summarize, or rewrite portal data on the read path. Evidence (`source`, `publisherId`, `matchType`) is structured and machine-parseable.
- **II. Spec-Driven Development**: PASS (retrospective). WHAT in spec.md, HOW here and in data-model.md, VALIDATION in tasks.md + the test suite.
- **III. Contract-First API Design**: PASS / N/A external. No MCP tool or portal endpoint is added or changed; no new portal endpoint is consumed. `contracts/` is intentionally empty (see `.gitkeep`). The internal `Extractor` contract is unchanged — the new extractor implements the existing interface.
- **IV. Operational Excellence**: PASS. Curation logging (`curate.completed` with `entitiesAttached`) is unchanged; the extractor fails closed (missing/unknown publisher → `[]`, no throw), so it cannot crash a curate run.
- **V. Simplicity & YAGNI**: PASS. ~37 lines; reuses the existing gazetteer and DI pattern (mirrors `CkanOrganizationExtractor`). No new abstraction, table, or column. The confidence-precedence behavior is achieved with the *existing* composite key + max-confidence read, not new machinery.
- **VI. Fast Feedback Loops**: PASS. Pure functions over in-memory rows; unit tests are fixture-driven (no network). Full suite stayed fast (986 pass).
- **VII. Type Safety & Validation**: PASS. Strict TypeScript, no `any` in source; the extractor returns typed `EntityCandidate[]`. Inputs are the already-validated stored `OrganizationRow` / `DatasetRow`.
- **VIII. 100% Test Coverage & Endpoint Parity**: PASS. New extractor has dedicated unit tests covering all four branches (municipal hit, below-in-content confidence, national publisher → none, missing/unknown publisher → none); the integration `enrichment-guarantees` test (SC-011) was updated to assert the recall effect (Sofia cohort 3→6, clique 3→15). No new portal endpoint → no parity-matrix entry required. Full suite: 986 pass, 0 fail; lint + typecheck clean.
- **IX. Data Freshness & Sync Integrity**: PASS / N/A. No change to sync, freshness metadata, or tombstones; this is a curation-side enrichment over already-synced rows.
- **X. Bulgarian-Locale Awareness**: PASS. Reads `org.title_bg` and matches Cyrillic against the gazetteer; preserves authoritative organisation names untouched. Tests use Cyrillic fixtures ("Община Бургас", "Министерство на финансите").
- **XI. Respectful Crawling**: PASS / N/A. No network access; operates on the local store.

No violations → Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/014-publisher-geo-recall/
├── plan.md              # This file
├── spec.md              # WHAT + success criteria
├── research.md          # Measurement (why 73.6% recoverable) + confidence-ordering rationale
├── data-model.md        # EntityCandidate + dataset_entities provenance; publisher evidence
├── quickstart.md        # How to materialize: danni curate --entities-only
├── contracts/           # Empty (no external contract) — .gitkeep with note
├── checklists/
│   └── requirements.md   # Spec quality checklist
└── tasks.md             # Implementation tasks (done)
```

### Source Code (repository root)

```text
src/
├── enrich/
│   ├── extractor.ts                         # Extractor interface + EntityCandidate (unchanged)
│   ├── extractors/
│   │   ├── bg-admin-gazetteer.ts            # In-content place extractor (0.95/0.75) — existing
│   │   └── bg-admin-publisher.ts            # NEW: publisher-name place extractor (0.7/0.6)
│   ├── gazetteer/
│   │   └── bg-admin.ts                      # findGazetteerMatches() — reused unchanged
│   └── register-entities.ts                 # Runs extractors, upserts entity + attaches provenance
├── curate/
│   └── run-curate.ts                        # Extractor registration (publisher BEFORE in-content)
└── store/repos/
    ├── organizations.ts                     # OrganizationsRepo.get() — reused
    └── entities.ts                          # EntitiesRepo.attach() — INSERT OR REPLACE, PK includes extractor

tests/
├── unit/enrich/extractors/
│   └── bg-admin-publisher.test.ts           # NEW: 4 branch tests
└── integration/
    └── enrichment-guarantees.test.ts        # Updated SC-011: Sofia cohort 3→6, clique 3→15
```

**Structure Decision**: Single project. The feature is a self-contained addition to the existing `src/enrich/extractors/` family plus a one-line registration change in `src/curate/run-curate.ts`; no new directories or modules beyond the new extractor file and its test.

## Complexity Tracking

> No Constitution Check violations — nothing to justify.
