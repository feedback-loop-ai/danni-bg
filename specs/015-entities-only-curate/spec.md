# Feature Specification: Entities-only curate mode (re-extract without re-parsing)

**Feature Branch**: `feat/curate-entities-only`  
**Created**: 2026-06-16  
**Status**: Implemented (shipped via PR #20, merged 2026-06-16; verified by the test suite — 987 pass / 0 fail)  
**Input**: User description: "A full `danni curate` re-parses every captured resource into memory and was OOM-killed on the ~16k-resource live mirror (>20 GB RSS). But entity extraction reads dataset/resource metadata rows, not parsed artifacts — so re-parsing is pure waste when only an extractor/gazetteer changed. Add an entities-only mode that re-runs the extractors + cross-dataset linking + entity-relation materialization only, skipping resource parsing and translation."

## Clarifications

### Session 2026-06-16

- Q: Does entities-only change any database schema or external contract? → A: No. It adds one boolean option (`runCurate({ entitiesOnly })`) and one CLI flag (`danni curate --entities-only`); the existing schema, the existing entity/link/relation upserts, and the `RunCurateResult` shape are all reused unchanged. There is therefore no migration. The CLI contract gains one flag, documented in `contracts/cli.md`.
- Q: Is re-running entities-only over the whole catalog safe? → A: Yes. The writes it performs — `dataset_entities`, `dataset_links`, and `entity_relations` — are all PK-guarded `INSERT OR REPLACE` upserts keyed by `(dataset, entity, extractor)`, `(dataset_a, dataset_b, via_entity, heuristic)`, and `(subject, predicate, object)` respectively. Re-running re-asserts the same rows; it does not duplicate or accumulate.
- Q: Why skip translation too, not just parsing? → A: Translation is the other resource-cost on the curate path: it needs a translator (a LAN-hosted MarianMT/hosted-API call). An extractor/gazetteer change does not change source Bulgarian text, so the already-written translations are still valid. Skipping translation lets entities-only run with no LAN access and no translator constructed at the CLI.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Refresh entities after an extractor/gazetteer change without OOM (Priority: P1)

After changing an extractor or the gazetteer (e.g. the publisher-region recall in #19), an operator re-runs entity attachment across the whole local mirror to materialize the new matches — and the run completes within memory instead of being OOM-killed partway through, leaving an inconsistent partial state.

**Why this priority**: This is the entire reason the feature exists. The full re-curate that #19 needed was OOM-killed mid-run on the live mirror (national bucket dropped 6,721 → 3,214, then the process died), because `danni curate` re-parses every captured resource into memory (~16k files → >20 GB RSS, swap exhausted). Entity extraction never reads those parsed artifacts — it reads dataset/resource metadata rows — so the parse was pure waste. Without a low-memory path, the recall could not be materialized at all on real data.

**Independent Test**: On a store with at least one captured, successfully-parsed-able resource, run curate in entities-only mode and confirm it attaches entities (including a publisher-derived place) while writing zero curated artifacts and zero translations, and that resident memory stays bounded well below a full re-curate.

**Acceptance Scenarios**:

1. **Given** a dataset whose resource has a successful capture on disk that a full curate would parse, **When** curate runs in entities-only mode, **Then** `entitiesAttached > 0` (the dataset's entities are re-asserted, including the publisher-derived place) and `curated === 0`, `uncurated === 0`, and `translationsWritten === 0`.
2. **Given** the same store, **When** entities-only curate completes, **Then** the `curated_artifacts` table has no new rows for that dataset (the resource was not parsed).
3. **Given** the whole-catalog scale of the live mirror (~16k resources), **When** entities-only curate runs, **Then** it completes the full catalog without being OOM-killed, at resident memory far below the full re-curate's footprint.

---

### User Story 2 - Run without a translator or LAN access (Priority: P2)

An operator runs the entities refresh on a machine with no access to the translation backend (the LAN-hosted MarianMT / hosted-API endpoint), and curate neither constructs a translator nor attempts any translation.

**Why this priority**: A full curate constructs a translator at the CLI and translates each dataset's title/description. Requiring the translation backend for an entities-only refresh would couple a cheap, metadata-only operation to LAN connectivity it does not need. It is P2 because the core OOM relief (US1) is independent of the translator path, but the no-LAN guarantee makes the mode genuinely lightweight and broadly runnable.

**Independent Test**: Pass a translator into entities-only curate and confirm no translation is written (the translator is ignored); separately, confirm the CLI does not construct a translator when `--entities-only` is given.

**Acceptance Scenarios**:

1. **Given** a translator supplied to `runCurate({ entitiesOnly: true, translator })`, **When** curate runs, **Then** `translationsWritten === 0` and the `translations` table is not written for that run (the translator is ignored).
2. **Given** the `--entities-only` flag at the CLI, **When** `danni curate --entities-only` runs, **Then** the CLI does not build a translator (no translator endpoint/LAN configuration is required for the run to succeed).

---

### User Story 3 - Idempotent re-runs over the whole catalog (Priority: P3)

An operator can re-run entities-only curate repeatedly over the entire catalog without producing duplicate or accumulating entity/link/relation rows.

**Why this priority**: Materializing a recall is iterative — an operator may re-run after each gazetteer tweak. The mode is only safe to recommend "run it over everything" if the writes are idempotent. It is P3 because the underlying upserts already enforced this before the feature; entities-only inherits it rather than adding it, so it needs assertion, not new mechanism.

**Independent Test**: Run entities-only curate twice over the same store and confirm the resulting `dataset_entities` / `dataset_links` / `entity_relations` row sets are identical (no duplicates, no growth).

**Acceptance Scenarios**:

1. **Given** a store that has already had entities-only curate applied, **When** it is run again with no source changes, **Then** the `dataset_entities`, `dataset_links`, and `entity_relations` row sets are unchanged (the PK-guarded `INSERT OR REPLACE` upserts re-assert the same rows).
2. **Given** an extractor/gazetteer change that adds a match, **When** entities-only curate re-runs, **Then** the new entity rows appear and pre-existing rows are preserved, with no duplicate `(dataset_id, entity_id, extractor)` rows.

---

### Edge Cases

- A dataset whose resources have no successful capture on disk — entities-only never touches resource files at all, so it behaves identically whether the raw files are present, stale, or absent (it reads only metadata rows).
- A dataset that matches a place both in-content (gazetteer) and via its publisher organization — `dataset_entities` keeps one row per extractor (the PK includes the extractor), so both rows persist; the read layer takes the max confidence per `(dataset, entity)`, so the stronger in-content match (0.95/0.75) wins downstream over the publisher signal (0.7/0.6). Entities-only re-asserts both rows.
- A translator is supplied to `runCurate` in entities-only mode — it is ignored (no translation is attempted), so passing one is harmless.
- Cross-dataset linking and entity-relation materialization run in entities-only mode exactly as in a full run: both operate over the entity graph (not parsed artifacts) and are global + idempotent, so they reconcile regardless of which datasets ran.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `runCurate` MUST accept an `entitiesOnly` option; when set, it MUST re-run entity extraction (the registered extractors), cross-dataset linking, and entity-relation materialization, and it MUST skip parsing every captured resource into curated artifacts.
- **FR-002**: In entities-only mode, curate MUST write zero curated artifacts: `curated`, `uncurated`, and the count of new `curated_artifacts` rows MUST all be 0.
- **FR-003**: In entities-only mode, curate MUST skip translation entirely: `translationsWritten` MUST be 0 even when a translator is supplied to `runCurate`.
- **FR-004**: The CLI MUST expose `danni curate --entities-only`; when that flag is given the CLI MUST NOT construct a translator (so the run requires no translation backend / LAN access).
- **FR-005**: Entities-only mode MUST attach entities from dataset/resource metadata rows, including the publisher-derived place, with the same per-extractor `dataset_entities` rows a full run would produce for the metadata-only extractors.
- **FR-006**: The entity, link, and relation writes performed in entities-only mode MUST be idempotent: re-running over the same store with no source changes MUST NOT create duplicate or accumulating rows (PK-guarded `INSERT OR REPLACE`).
- **FR-007**: Entities-only mode MUST return the same `RunCurateResult` shape as a full run (with the parse/translation-derived counts at 0), so callers and stdout JSON are unchanged.
- **FR-008**: Entities-only mode MUST NOT change any database schema or any external contract beyond adding the one CLI flag; it MUST add no migration.

### Key Entities

- **dataset_entities** (`migrations/002_curate_enrich.sql`): dataset→entity edges with provenance, PK `(dataset_id, entity_id, extractor)`, written by `registerEntities`. Entities-only re-asserts these rows; the per-extractor PK is why a publisher match and an in-content match coexist rather than overwrite.
- **dataset_links** (`migrations/002_curate_enrich.sql`): cross-dataset links via a shared entity, PK `(dataset_a_id, dataset_b_id, via_entity_id, heuristic)`, written by `linkAllSharedEntities`. Re-asserted idempotently in entities-only mode.
- **entity_relations** (`migrations/007_entity_relations.sql`): entity↔entity edges (e.g. municipality `part_of` oblast), PK `(subject_id, predicate, object_id)`, written by `registerEntityRelations`. Global + idempotent; runs in entities-only mode.
- **curated_artifacts** (`migrations/002_curate_enrich.sql`): per-resource parsed output. This is the table entities-only **skips** — no new rows are written because the resource-parse loop is not entered.
- **translations** (`migrations/002_curate_enrich.sql`): BG→EN derived helpers for dataset title/description. Also **skipped** in entities-only mode.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Entities-only curate completes the full live-mirror catalog (~16k resources) without being OOM-killed, at a resident memory footprint roughly two orders of magnitude below the full re-curate (≈140 MB RSS vs ≈20 GB RSS).
- **SC-002**: For a store with a captured, parse-able resource, an entities-only run reports `curated === 0`, `uncurated === 0`, `translationsWritten === 0`, and `entitiesAttached > 0`, and adds zero `curated_artifacts` rows for the dataset.
- **SC-003**: An entities-only run with a translator supplied writes zero translations (the translator is ignored), and `danni curate --entities-only` succeeds with no translation backend reachable.
- **SC-004**: Re-running entities-only curate over an unchanged store leaves the `dataset_entities`, `dataset_links`, and `entity_relations` row sets identical (no duplicates, no growth).
- **SC-005**: The full test suite stays green with the addition: 987 pass / 0 fail, lint + typecheck clean.

## Assumptions

- This is a retrofit: the work is already shipped (PR #20) and verified, so the spec is written in the settled tense and marked Implemented.
- No new database migration and no schema change: entities-only reuses the existing `dataset_entities` / `dataset_links` / `entity_relations` upserts and the existing `RunCurateResult` shape.
- The CLI contract gains exactly one flag (`--entities-only`); no other command, flag, or exit code changes.
- The entity/link/relation upserts were already idempotent (PK-guarded `INSERT OR REPLACE`) before this feature; entities-only inherits that idempotency rather than introducing it.
- Out of scope: any change to what the extractors detect, any new extractor/gazetteer, any change to the full-curate parse or translation behavior, and the operational live-mirror re-run itself (entities-only is the mechanism; running it on production data is a separate operation noted as PR follow-up).
