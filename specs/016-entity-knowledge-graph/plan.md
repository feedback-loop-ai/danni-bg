# Implementation Plan: Entity knowledge graph (typed entity↔entity relations)

**Branch**: `016-entity-knowledge-graph` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-entity-knowledge-graph/spec.md`

**Status**: Implemented (shipped in PR #23). This plan is written retrospectively against the merged code.

## Summary

Promote the implicit administrative hierarchy (municipality → parent oblast), previously known only from the bundled gazetteer crosswalk JSON, into a formal, queryable knowledge-graph layer. Add migration **007** creating `entity_relations` — directed, typed, provenanced triples between canonical entities. Define a closed, documented predicate vocabulary (currently `part_of`). Add `EntityRelationsRepo` for subject/object/predicate traversal, and `registerEntityRelations` to materialise the `part_of` edges from the gazetteer over the entities present in the corpus at the end of curate (idempotent). Expose one entity's graph node — labels, incoming/outgoing typed relations, direct dataset count — via `GET /api/entities/:id`, backed by `ReadBridge.entityGraph`. Dataset→entity edges deliberately stay in `dataset_entities`; this layer is entity↔entity only.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Bun 1.x  
**Primary Dependencies**: `bun:sqlite` (store), Hono (explorer API), Zod (existing boundary validation); no new runtime dependency  
**Storage**: the single durable `danni.sqlite` store; new table via checked-in migration `migrations/007_entity_relations.sql`  
**Testing**: `bun:test` — repo unit tests, materialiser unit tests, endpoint route tests (the full suite reports 993 pass, 0 fail for the PR)  
**Target Platform**: Linux server (CLI `danni curate`; `apps/explorer-api` HTTP service)  
**Project Type**: web service + CLI over a local mirror store (single repo, multiple apps)  
**Performance Goals**: hundreds of edges; subject/object/predicate lookups are single indexed queries — sub-millisecond  
**Constraints**: must not duplicate the dataset→entity layer; must be idempotent at curate time; authoritative portal data untouched (derived layer only)  
**Scale/Scope**: 265 municipalities / 28 oblasts in the gazetteer; 249 `part_of` edges live (municipalities present in the corpus)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.* Evaluated against constitution v1.1.0.

- **I. AI-Native Development**: PASS. The graph is a derived, machine-parseable read layer. Edges carry confidence + `evidence_json` provenance (`{ source: "gazetteer" }`); the read path does not invent or alter authoritative portal data — it materialises a hierarchy from the bundled gazetteer and surfaces it as a typed node. `GET /api/entities/:id` returns a structured node; unknown ids return the structured `not_found` envelope (no generic errors).
- **III. Contract-First API Design**: PASS. The new endpoint's response contract is captured as `contracts/entities-get.md` (+ `entities-get.schema.json`) and reuses the shared error envelope/codes from 008's HTTP API contract. The predicate set is a closed, documented vocabulary — relations map to a defined administrative concept, not an invented abstraction.
- **V. Simplicity & YAGNI**: PASS. A single relational triple table in the existing store rather than an RDF/triple-store engine; one predicate (`part_of`) — exactly what the data needs today, no speculative predicates. The decision is justified in `research.md`.
- **VII. Type Safety & Validation**: PASS. `EntityPredicate` is a closed union with an `isEntityPredicate` type guard; `UpsertRelationInput.predicate` is typed to it. The table enforces `confidence` ∈ (0, 1] via CHECK and entity-existence via foreign keys. `EntityGraphView`/`EntityNode`/`EntityRelationEdge` are explicit interfaces.
- **VIII. 100% Test Coverage & Endpoint Parity**: PASS. `EntityRelationsRepo` (assert/read-both-directions/idempotent), `registerEntityRelations` (present-only, parent upsert, idempotent), and the endpoint (typed relations both directions + 404) are all covered. The `GET /api/entities/:id` endpoint has a contract test registered in the parity matrix. No render-glue exception is invoked here.
- **IX. Data Freshness & Sync Integrity**: PASS (not weakened). This is a derived hierarchy layer, not a portal mirror; it carries no portal `last_synced_at` of its own. It is rebuilt idempotently at curate time from the entities currently present, so it tracks the synced corpus rather than asserting independent freshness. Dataset/resource freshness blocks on other endpoints are unaffected.
- **X. Bulgarian-Locale Awareness**: PASS. Canonical labels (`canonical_label_bg`) are carried verbatim from the gazetteer/entities; English labels are a clearly separate `labelEn` field (derived, nullable). No authoritative field is rewritten. Cyrillic ids/labels round-trip through the triple store unchanged.

No deviations — Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/016-entity-knowledge-graph/
├── plan.md              # This file
├── spec.md              # Feature spec (Implemented)
├── research.md          # Property-graph-in-SQLite vs RDF; layer separation; controlled vocabulary
├── data-model.md        # entity_relations schema + predicate vocabulary + EntityGraphView
├── quickstart.md        # GET /api/entities/:id examples; how part_of is materialised
├── contracts/
│   ├── entities-get.md          # GET /api/entities/:id response contract
│   └── entities-get.schema.json # JSON Schema for EntityGraphView
├── checklists/
│   └── requirements.md  # Requirements quality checklist
└── tasks.md             # Task breakdown (done)
```

### Source Code (repository root)

```text
migrations/
└── 007_entity_relations.sql            # entity_relations table + reverse/predicate indexes

src/
├── enrich/
│   └── relations/
│       ├── vocabulary.ts               # ENTITY_PREDICATES (closed set) + isEntityPredicate guard
│       └── register-relations.ts       # registerEntityRelations (materialise part_of from gazetteer)
├── curate/
│   └── run-curate.ts                   # calls registerEntityRelations at end of curate; reports relationsCreated
└── store/
    └── repos/
        └── entity-relations.ts         # EntityRelationsRepo (upsert / bySubject / byObject / count)

apps/explorer-api/
├── src/
│   ├── app.ts                          # GET /api/entities/:entityId route
│   ├── read-bridge.ts                  # ReadBridge.entityGraph
│   └── schemas.ts                      # EntityGraphView / EntityNode / EntityRelationEdge
└── tests/
    └── app.test.ts                     # endpoint route test (both directions + 404)

tests/unit/
├── enrich/relations/register-relations.test.ts
└── store/repos/entity-relations.test.ts
```

**Structure Decision**: Reuses the established repo layout — store layer (`src/store/repos/`), enrichment layer (`src/enrich/`), curate orchestration (`src/curate/`), and the `apps/explorer-api` Hono service with its `ReadBridge` indirection between routes and the store. The new relation layer slots in as a sibling of the existing entity/link layers; the endpoint follows the same `app.ts` → `ReadBridge` → repo path as the rest of the API.

## Complexity Tracking

> No constitution violations — no entries required.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
