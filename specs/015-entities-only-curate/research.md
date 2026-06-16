# Phase 0 Research — 015-entities-only-curate

**Date**: 2026-06-16
**Status**: Implemented. Records the decisions behind the shipped, verified work (PR #20).

This feature is a **retrofit**: the entities-only mode was implemented and verified (full suite
green, lint + typecheck clean) *before* this artifact was written. The unknown was never "what
should the behavior be" — the OOM during the #19 recall pinned it — but "what is the minimal,
safe change that gives a low-memory entity refresh without re-parsing or re-translating." There
is **no new migration** and **no schema change**; the only external-surface change is one CLI
flag, documented in `contracts/cli.md`. Each decision below is in the canonical
**Decision / Rationale / Alternatives considered** form and is grounded in the code actually
read (`src/curate/run-curate.ts`, `src/cli/curate.ts`, `src/enrich/extractors/bg-admin-publisher.ts`,
`migrations/002_curate_enrich.sql`, `migrations/007_entity_relations.sql`, and the new test).

---

## R1 — The OOM diagnosis: full curate ≈20 GB RSS vs entities-only ≈140 MB RSS

**Decision**: Add an entities-only mode that **never enters the per-resource parse loop**, rather
than trying to make the full parse cheaper (streaming, chunking, eviction).

**Rationale**: The full re-curate that #19's publisher-region recall needed was OOM-killed mid-run
on the live mirror: `danni curate` walks every active dataset and, for each, parses every captured
resource (`CuratorRegistry.curate` over `<storeRoot>/raw/<raw_path>`) into memory before attaching
entities. On the ~16k-resource mirror this drove resident memory past 20 GB, swap was exhausted,
and the process died partway — the national bucket had dropped 6,721 → 3,214 and then froze in an
inconsistent partial state. The diagnosis: **entity extraction does not need the parsed artifacts
at all**. The registered extractors (`CkanOrganizationExtractor`, `CkanGroupsExtractor`,
`CkanTagsExtractor`, `BgAdminPublisherExtractor`, `BgAdminGazetteerExtractor`,
`Iso8601DatesExtractor`, `BgMonthDatesExtractor`, `ColumnNameHeuristicsExtractor`) and
`registerEntities` read dataset/resource **metadata rows** (title, description, tags, publisher
org, column names), never the parsed file bytes. So the parse was pure waste for an
extractor/gazetteer change. Skipping it drops the footprint from ≈20 GB to ≈140 MB — roughly two
orders of magnitude — and lets the whole catalog finish (SC-001).

**Alternatives considered**:
- *Stream/chunk the parse or evict parsed artifacts after each resource*: rejected — it would
  reduce the footprint but still pay the full parse cost for an operation that needs none of it,
  and it is a materially larger, riskier change to the curator. YAGNI (Principle V): the cited
  problem is that the parse is *unnecessary* here, so the fix is to not do it.
- *Raise the memory limit / add swap*: rejected — not a fix, just defers the OOM and still wastes
  hours of parsing for a metadata-only refresh.
- *Restrict the full re-curate to changed datasets via `--datasets`/`--since`*: rejected — a
  gazetteer change can match *any* dataset, so the recall genuinely needs the whole catalog; the
  problem is the per-resource parse, not the dataset count.

---

## R2 — Why re-parsing is unnecessary: extraction reads metadata rows, not parsed artifacts

**Decision**: In entities-only mode, `break` out of the per-resource loop on the first iteration
(before any `existsSync`/parse), and still run `registerEntities`, `linkAllSharedEntities`, and
`registerEntityRelations` for every targeted dataset.

**Rationale**: The curate loop has two distinct phases per dataset: (1) parse each captured
resource and upsert a `curated_artifacts` row, then (2) attach entities from the dataset + its
resource **metadata** and accumulate touched entity ids. Phase (2) consumes the dataset/resource
rows (`DatasetsRepo`, `ResourcesRepo.listByDataset`) and the extractors — it never reads the
on-disk parsed output written in phase (1). The two phases are therefore independent: skipping (1)
does not change the input to (2). The implementation places the guard as the very first statement
in the inner loop — `if (opts.entitiesOnly) break;` — so no resource file is touched at all (this
also makes the mode robust to missing/stale raw files: it reads only metadata). After the loop,
the cross-dataset linking (over the touched entity ids) and the global entity-relation
materialization (over all entities) run exactly as in a full run, because both operate on the
entity graph, not on parsed artifacts.

**Alternatives considered**:
- *Skip parsing but keep translation*: rejected — translation is the other resource-cost on the
  path (it calls the LAN-hosted translator). An extractor/gazetteer change does not change source
  Bulgarian text, so the already-written translations are still valid; running them again would
  add a LAN dependency for no benefit (R3).
- *Run only `registerEntities` and skip linking/relations*: rejected — linking and relations are
  cheap, operate over the entity graph (not artifacts), and are global + idempotent, so they
  correctly reconcile the recall's new entities into the link/relation graph. Skipping them would
  leave the graph stale after an entity change.

---

## R3 — Skip translation too; do not construct a translator at the CLI

**Decision**: Guard the translation block with `if (opts.translator && !opts.entitiesOnly)`, and
at the CLI, when `--entities-only` is set, pass `{ entitiesOnly: true }` and do **not** call
`buildTranslator(config)` (the spread is mutually exclusive: `flags.entitiesOnly ? { entitiesOnly:
true } : { translator: buildTranslator(config) }`).

**Rationale**: A full curate constructs a translator (`LocalMarianMtTranslator` or
`HostedApiTranslator`) and translates each dataset's title/description via `translateSubjects`. The
translator talks to a LAN-hosted MarianMT or a hosted-API endpoint. An entities-only refresh
changes only which *entities* attach — it does not change the source BG text, so the prior
translations remain valid; re-translating would be wasted work and, worse, would couple a
metadata-only operation to LAN connectivity. Guarding the block makes `translationsWritten === 0`
(FR-003), and *not constructing* the translator at the CLI means the run needs no translator
endpoint/config to be reachable (FR-004) — the mode is genuinely runnable on a host with no LAN
access. The test passes a translator into `runCurate({ entitiesOnly: true })` and asserts it is
ignored (`translationsWritten === 0`), proving the guard is at the run level too, not only the CLI.

**Alternatives considered**:
- *Guard only at the CLI (don't build a translator) but leave the run-level block unguarded*:
  rejected — `runCurate` is a library function other callers/tests use; a caller that passes a
  translator in entities-only mode should still get no translation. Guarding both the run and the
  CLI makes the contract robust regardless of caller.
- *Translate anyway when a translator happens to be supplied*: rejected — it re-introduces the LAN
  cost the mode exists to avoid and contradicts FR-003.

---

## R4 — Idempotency and no migration: PK-guarded INSERT OR REPLACE upserts

**Decision**: Ship entities-only with **no schema change and no migration**, relying on the
existing PK-guarded `INSERT OR REPLACE` upserts so the whole-catalog re-run is safe.

**Rationale**: The three tables entities-only writes all have composite primary keys that make
re-asserting a row a no-op-equivalent (replace-in-place, never duplicate):
- `dataset_entities` PK `(dataset_id, entity_id, extractor)` (`migrations/002_curate_enrich.sql`)
  — written by `registerEntities`. Because the PK includes the **extractor**, a place matched both
  in-content (`BgAdminGazetteerExtractor`) and via publisher (`BgAdminPublisherExtractor`) keeps a
  **row per extractor**; they do not overwrite each other. The read layer takes the **max
  confidence** per `(dataset, entity)`, so the stronger in-content match (0.95/0.75) wins downstream
  over the publisher signal (0.7/0.6). The shipped change corrected the stale "must run BEFORE …
  last writer wins" comments in `run-curate.ts` and `bg-admin-publisher.ts` to describe this real
  per-extractor / max-confidence behavior.
- `dataset_links` PK `(dataset_a_id, dataset_b_id, via_entity_id, heuristic)` — written by
  `linkAllSharedEntities`.
- `entity_relations` PK `(subject_id, predicate, object_id)` (`migrations/007_entity_relations.sql`)
  — written by `registerEntityRelations`; explicitly "Global + idempotent, so it reconciles
  regardless of which datasets ran."

Because the upserts were already idempotent before this feature, entities-only inherits the
property — running it once or many times over an unchanged store yields the same row sets (FR-006,
SC-004). And because it writes only into pre-existing tables (and skips `curated_artifacts` /
`translations`), there is nothing to migrate (FR-008): the schema is untouched.

**Alternatives considered**:
- *Add a "last-extracted" marker column or a run ledger for entities-only*: rejected — the upserts
  are already idempotent, so no marker is needed to make re-runs safe; adding one would be schema
  churn for no benefit (Principle V).
- *Delete-then-insert per dataset to "clean up" stale entities*: rejected — out of scope and risky;
  it could drop entities still valid from other evidence, and the recall's goal is to *add* matches
  while preserving existing ones. The PK-guarded replace preserves correctness without a destructive
  pass.
