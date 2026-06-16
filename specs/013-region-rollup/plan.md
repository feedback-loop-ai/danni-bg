# Implementation Plan: Hierarchical region roll-up (municipality → oblast, via the part_of graph)

**Branch**: `013-region-rollup` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/013-region-rollup/spec.md`
**Status**: Implemented (shipped via PRs #18, #24, #25; verified by the backend + shared-logic test suite — full suite green, lint + typecheck clean at the final fold-in)

## Summary

Region counts on the map explorer (spec 008) were a flat per-entity tally, so a
municipality-tagged dataset never rolled into its oblast unless the text also named the
province. Because municipality geo recall (~5.1k) is ~2.6× oblast recall (~1.9k), the
municipalities of an oblast held *more* datasets than the oblast — the "parts don't add up to
the whole" defect. This feature makes an oblast's count the **de-duplicated union** of its
direct datasets plus all of its municipalities' datasets (a dataset on both counted once, at
its strongest confidence), shipped in three increments:

1. **Hierarchical, deduped roll-up (PR #18).** `aggregateRegions`
   (`apps/explorer-api/src/regions-aggregate.ts`) gained an optional
   `rollup(linkEntityId) => regionIds[]` mapping (default identity → existing flat behavior).
   Per dataset, links are collapsed to the **max confidence per target** before bucketing, so the
   union de-dups by dataset id. `GET /api/regions` passes a roll-up that maps oblast→self and
   municipality→parent oblast; `GET /api/regions/:id` uses a roll-up-aware membership check
   (`belongsConfidence`) so the detail list + count match the aggregate exactly.

2. **Graph-sourced hierarchy (PR #24).** The municipality→oblast parent now comes from the
   `part_of` knowledge graph instead of the crosswalk's `oblastEntityId`. New
   `ReadBridge.partOfParents()` (`apps/explorer-api/src/read-bridge.ts`) builds the
   `municipality→oblast` map from `EntityRelationsRepo.byPredicate('part_of')` (new repo method,
   `src/store/repos/entity-relations.ts`). `rollupTargets` in `apps/explorer-api/src/app.ts`
   classifies oblast vs. municipality by entity-id namespace and resolves the parent from that
   map. `aggregateRegions` gained an optional `parentOf` resolver so the emitted `oblastEntityId`
   (drives drill-down) is graph-sourced too.

3. **Crosswalk cleanup (PR #25).** Removed the now-redundant `oblastEntityId` field from the
   crosswalk schema + its two `superRefine` invariants
   (`packages/geo-boundaries/src/schema.ts`), stopped emitting it in the generator
   (`packages/geo-boundaries/scripts/generate-crosswalk.ts`), regenerated
   `packages/geo-boundaries/data/crosswalk.json` (293 entries), and dropped the dead crosswalk
   fallback in `regions-aggregate.ts` so `oblastEntityId` is solely the graph-backed `parentOf`.

No new portal endpoint, dataset family, or migration is introduced. The roll-up reads the
existing `entity_relations` table (owned by spec 016) and the existing geo crosswalk; only the
*bucketing* of already-extracted placements changes.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Bun 1.x  
**Primary Dependencies**: Hono (explorer-api routes), Zod (crosswalk schema validation); reads `bun:sqlite` `entity_relations` via `EntityRelationsRepo`  
**Storage**: Existing SQLite local mirror (`entity_relations` table for `part_of` edges); bundled `packages/geo-boundaries/data/crosswalk.json` for entity↔boundary/code joins. No new table, no migration.  
**Testing**: `bun:test` (`apps/explorer-api/tests/*`, `packages/geo-boundaries/tests/*`, `tests/unit/store/repos/*`), 100% line+branch on changed logic  
**Target Platform**: Linux server (explorer-api backend behind the SPA)  
**Project Type**: Web — multi-package monorepo (`apps/explorer-api` backend + `apps/explorer-web` SPA + `packages/geo-boundaries`)  
**Performance Goals**: Whole-catalog endpoint (`/api/regions`) computed over the full ~11k-dataset mirror from a bulk lite projection (no per-dataset fan-out); roll-up is O(links) per dataset  
**Constraints**: Aggregation stays a pure, DB-free function; the read path must not invent or alter authoritative placements (Principle I)  
**Scale/Scope**: 28 oblasts, 265 municipalities (243 with data on the live mirror); ~7k geo-linked datasets

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against `.specify/memory/constitution.md` v1.1.0:

- **I. AI-Native Development (NON-NEGOTIABLE)** — PASS. The roll-up only re-buckets authoritative, already-extracted geo placements; it invents no data and alters no upstream field. Region summaries remain deterministic projections over the synced store.
- **II. Spec-Driven Development** — PASS (retrospective). WHAT in this `spec.md`, HOW here + `data-model.md` + `contracts/`, VALIDATION in the cited `bun:test` suites and `tasks.md` checkpoints.
- **III. Contract-First API Design** — PASS. No new portal endpoint or MCP tool. The affected explorer-API endpoints (`/api/regions`, `/api/regions/:id`) and the `RegionSummary` shape are documented in `contracts/regions-api.md`; the crosswalk schema change is captured in `data-model.md`.
- **IV. Operational Excellence** — PASS. Graceful degradation preserved: an un-materialised `part_of` graph yields direct-link-only counts (smaller but never wrong), no crash. No new failure modes on the read path.
- **V. Simplicity & YAGNI** — PASS. One optional `rollup` param + one optional `parentOf` resolver on an existing pure function; the namespace-based level classification avoids a new lookup. PR #25 *deletes* the now-redundant `oblastEntityId` crosswalk field (dead code is negative value).
- **VI. Fast Feedback Loops (NON-NEGOTIABLE)** — PASS. The aggregation is unit-tested DB-free; municipality/oblast roll-up cases run in milliseconds against in-memory fixtures.
- **VII. Type Safety & Validation (NON-NEGOTIABLE)** — PASS. Strict TS throughout; the crosswalk is Zod-validated at load (`packages/geo-boundaries/src/schema.ts`), and removing `oblastEntityId` removed its two `superRefine` invariants cleanly.
- **VIII. 100% Test Coverage & Endpoint Parity (NON-NEGOTIABLE)** — PASS. All changed logic (`aggregateRegions`, `rollupTargets`, `partOfParents`, `byPredicate`, schema) is covered by the cited tests; the full suite is green. No render-glue exception is invoked (this is pure backend logic).
- **IX. Data Freshness & Sync Integrity (NON-NEGOTIABLE)** — PASS. No change to freshness metadata or sync; the feature reads the existing synced corpus and does not bypass the freshness path.
- **X. Bulgarian-Locale Awareness** — PASS. Authoritative Bulgarian region labels are passed through `labelOf` untouched; no transliteration or rewrite. Entity ids are ASCII slugs assigned by the gazetteer.
- **XI. Respectful Crawling (NON-NEGOTIABLE)** — N/A. No crawler/network behavior is touched.

No violations → Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/013-region-rollup/
├── plan.md              # This file
├── spec.md              # WHAT (user stories, FRs, success criteria)
├── research.md          # Phase 0 — crosswalk→graph migration of the hierarchy source; dedup semantics
├── data-model.md        # Phase 1 — RegionSummary (incl. oblastEntityId); how the roll-up buckets datasets
├── quickstart.md        # Phase 1 — verify the roll-up + invariant locally
├── contracts/
│   ├── regions-api.md    # /api/regions + /api/regions/:id behavior under roll-up
│   └── .gitkeep
├── checklists/
│   └── requirements.md   # Spec-quality checklist
└── tasks.md             # Phase 2 — implementation tasks (all [X], shipped)
```

### Source Code (repository root)

```text
apps/explorer-api/
├── src/
│   ├── regions-aggregate.ts   # pure aggregateRegions(): rollup + parentOf, dedup-by-target
│   ├── app.ts                 # rollupTargets() + GET /api/regions, GET /api/regions/:entityId
│   ├── read-bridge.ts         # ReadBridge.partOfParents(): municipality→oblast from part_of edges
│   └── schemas.ts             # RegionSummary (entityId, level, …, oblastEntityId?)
└── tests/
    ├── regions-aggregate.test.ts  # roll-up + dedup unit cases
    └── app.test.ts                # graph-sourced roll-up via /api/regions[/:id]

packages/geo-boundaries/
├── src/schema.ts                  # crosswalk entry schema (oblastEntityId removed in #25)
├── scripts/generate-crosswalk.ts  # crosswalk generator (no longer emits oblastEntityId)
├── data/crosswalk.json            # regenerated, 293 entries, no hierarchy field
└── tests/{crosswalk,schema}.test.ts

src/store/repos/
└── entity-relations.ts            # EntityRelationsRepo.byPredicate('part_of')

src/enrich/relations/
└── vocabulary.ts                  # ENTITY_PREDICATES.PART_OF (owned by spec 016)
```

**Structure Decision**: Web monorepo (established by spec 008). The feature lives almost
entirely in the existing `apps/explorer-api` backend (pure aggregation + two routes + a read-bridge
helper), with a supporting query method in the shared `src/store/repos` layer and a schema/data
cleanup in `packages/geo-boundaries`. No new package or app is introduced.

## Complexity Tracking

> No Constitution Check violations — section intentionally empty.
