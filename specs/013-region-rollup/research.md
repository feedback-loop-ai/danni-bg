# Phase 0 Research — 013-region-rollup

**Date**: 2026-06-16
**Status**: Implemented. Records the decisions behind the shipped, verified work (PRs #18, #24, #25).

This feature is a **retrofit**: the hierarchical roll-up was implemented and verified
(994 pass / 0 fail, lint + typecheck clean) *before* this artifact was written, across three
PRs that build on each other (#18 the roll-up + dedup, #24 the crosswalk→graph migration of the
hierarchy source, #25 the crosswalk field cleanup). There were no clarification rounds — the
problem was pinned by the live mirror ("municipalities exceed their parent oblast"), and the
unknowns were *how to bucket already-extracted placements correctly* and *where the
municipality→oblast hierarchy should live at runtime*. There is **no new migration** and the only
new contract surface is documented behavior on two existing explorer-API endpoints. Each decision
below is in **Decision / Rationale / Alternatives considered** form, grounded in the code actually
read (`apps/explorer-api/src/{regions-aggregate,app,read-bridge,schemas}.ts`,
`src/store/repos/entity-relations.ts`, `packages/geo-boundaries/src/schema.ts` +
`scripts/generate-crosswalk.ts`).

---

## R1 — Roll-up as an injected mapping on a pure aggregator, not a hard-coded hierarchy walk

**Decision**: `aggregateRegions` (`apps/explorer-api/src/regions-aggregate.ts`) takes an optional
`rollup(linkEntityId) => regionIds[]` that maps each dataset geo-link to the region ids it should
count toward. It defaults to identity (`(id) => [id]`), preserving the prior flat behavior. The
route layer (`app.ts`) supplies the actual roll-up (`rollupTargets`): oblast→self,
municipality→its parent oblast. The aggregator stays DB-free and unit-tested in isolation.

**Rationale**: Principle V (Simplicity) and VI (Fast Feedback) — keeping the hierarchy *out* of
the aggregator means the bucketing rules (dedup, max-confidence) are tested against tiny in-memory
fixtures with no SQLite, while the data-source wiring (graph map) is tested at the route layer. A
default-identity param means every existing caller is untouched (FR-010). It also let the
hierarchy source change (R3) without touching the aggregator's core loop.

**Alternatives considered**: (a) Hard-code municipality→oblast resolution inside the aggregator —
rejected: couples pure logic to a data source and breaks DB-free testing. (b) Pre-expand each
dataset's links to include parent oblasts before calling the aggregator — rejected: scatters the
dedup responsibility and makes max-confidence-per-target harder to keep correct.

---

## R2 — De-duplicate per (dataset, target) at max confidence, before bucketing

**Decision**: For each dataset, the aggregator first collapses its links into a
`Map<targetRegionId, maxConfidence>` (`perTarget`), taking the strongest confidence whenever
several links reach the same target. Only then does it add the dataset id to each target's
`Set<datasetId>` and raise the target's `maxConfidence`. So a dataset reaching an oblast via the
oblast link *and* a municipality link (or via two municipalities) is counted **once**, at its
strongest placement (FR-002, FR-003).

**Rationale**: The union semantics in FR-001 are only correct if overlaps collapse. Using a
`Set<datasetId>` per region makes the count a true distinct-dataset count; collapsing to max
confidence per target first means the recorded `maxConfidence` reflects the best evidence for the
dataset being in that region, not an artifact of link ordering. This is exactly the
"parts add up to the whole, once" invariant (SC-001, SC-002).

**Alternatives considered**: (a) Count per link then subtract overlaps — rejected: error-prone and
needs a second pass. (b) Take the first-seen or average confidence — rejected: non-deterministic
w.r.t. link order / dilutes a strong placement, violating FR-003.

---

## R3 — Source the municipality→oblast hierarchy from the `part_of` graph, not the crosswalk

**Decision**: The municipality→oblast parent used by `rollupTargets` and by the emitted
`oblastEntityId` is read from the `part_of` knowledge graph. `ReadBridge.partOfParents()`
(`apps/explorer-api/src/read-bridge.ts`) builds a `Map<municipalityId, oblastId>` from
`EntityRelationsRepo.byPredicate(ENTITY_PREDICATES.PART_OF)` — a new repo method
(`src/store/repos/entity-relations.ts`) returning every edge with the `part_of` predicate. Level is
classified by entity-id namespace (`geo:bg-oblast-*` vs. `geo:bg-municipality-*`) rather than by a
crosswalk lookup (FR-004, FR-005).

**Rationale**: When `part_of` became a first-class graph layer (spec 016, landed as #23), the
crosswalk's `oblastEntityId` was a *second copy* of the same gazetteer-derived mapping — two
sources that could drift. Consolidating onto the graph gives a single runtime source of truth
(Principle V; the consolidation was explicitly noted as a follow-up when the graph landed). The
behavior is identical when the graph is materialised because both derive from the same gazetteer
(see the migration-equivalence assumption in `spec.md`); the change is *where* the parent is read
from, not *what* it is.

**Alternatives considered**: (a) Keep reading `oblastEntityId` from the crosswalk — rejected:
leaves two copies of the hierarchy and re-introduces drift the moment the gazetteer and the graph
diverge. (b) Read the hierarchy from the gazetteer module directly at request time — rejected: the
graph already materialises it durably and is queried for the entity-node API anyway, so reuse the
graph.

---

## R4 — Pin the migration with a test that fails against the old path

**Decision**: PR #24 added an app-level test (`apps/explorer-api/tests/app.test.ts`) asserting that
a municipality dataset rolls into its oblast **only after** the `part_of` edge is materialised.
This test **fails** against the old crosswalk-sourced path (where the parent existed regardless of
graph state), so it positively pins that the parent is read from the graph (SC-005).

**Rationale**: Principle VIII — a refactor that claims behavioral equivalence must be guarded by a
test that distinguishes the two implementations, otherwise the "equivalent" claim is unverified.
Gating the roll-up on the existence of the edge is exactly the observable difference between
reading the graph and reading a static crosswalk field.

**Alternatives considered**: Asserting only the final counts — rejected: identical counts when the
graph is materialised would pass against *both* implementations and prove nothing about the source.

---

## R5 — Delete the redundant crosswalk `oblastEntityId` field (cleanup)

**Decision**: PR #25 removed `oblastEntityId` from the crosswalk entry schema and its two
`superRefine` invariants (`packages/geo-boundaries/src/schema.ts`), stopped emitting it in
`scripts/generate-crosswalk.ts`, regenerated `data/crosswalk.json` (293 entries; the diff is just
the removed key per entry), and dropped the dead crosswalk fallback in `regions-aggregate.ts` so
`oblastEntityId` on a summary is now solely the graph-backed `parentOf` (null when not supplied).

**Rationale**: Once R3 made the graph the source of truth, the crosswalk field was dead weight that
could only cause drift (Principle V: "dead code is negative value"). The crosswalk is now purely
entity↔boundary/code joins; the administrative hierarchy is the graph's job (FR-012, SC-006).

**Alternatives considered**: Leave the field as a documented fallback — rejected: a fallback that is
never read in production is exactly the redundant second copy this feature set out to eliminate; the
graph's own degradation (direct-links-only when un-materialised) is the honest fallback.

---

## R6 — `oblastEntityId` on the summary drives map drill-down; null when no parent

**Decision**: `RegionSummary` carries an optional `oblastEntityId` (`apps/explorer-api/src/schemas.ts`),
populated by `aggregateRegions` via the injected `parentOf(entityId)` resolver (graph-backed). It is
the parent oblast id for a municipality and null/absent when there is no parent (e.g. for oblasts
themselves, or orphan municipalities) (FR-008).

**Rationale**: The web map needs to know which oblast a municipality belongs to in order to drive
zoom/drill-down without a second request. Sourcing it from the same `parentOf` map that feeds the
roll-up guarantees the drill-down association and the count attribution agree.

**Alternatives considered**: Derive the parent on the client from the crosswalk — rejected:
re-duplicates the hierarchy on the client and re-creates the drift problem R3/R5 removed.
