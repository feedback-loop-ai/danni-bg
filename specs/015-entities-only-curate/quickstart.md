# Quickstart — Entities-only curate mode (015)

> **Audience**: an operator (or reviewer) who needs to refresh dataset→entity edges across the
> local mirror after changing an extractor or the gazetteer — without the full re-curate's
> ≈20 GB RSS parse that gets OOM-killed on the live mirror, and without a translation backend.
> This is a RETROFIT of already-shipped work (**Status: Implemented**, PR #20, 2026-06-16); the
> steps below confirm the behavior, not new functionality to enable. No new migration; no schema
> change.

All commands run from the repo root with Bun installed.

## When to use `--entities-only`

Use it when **only the entity layer needs to change** and the captured resources have not:

- You changed an extractor or the gazetteer (e.g. the publisher-region recall in #19) and need to
  re-materialize entity matches across the **whole catalog**.
- A full `danni curate` is being OOM-killed because it re-parses every captured resource (~16k on
  the live mirror → >20 GB RSS).
- You are on a host with **no LAN access** to the translation backend (entities-only constructs no
  translator).

Do **not** use it when you need to (re)parse resources into `curated_artifacts` or (re)write
BG→EN `translations` — those require a full `danni curate` (it parses and translates).

## 0. Green gate (run this first and last)

```bash
bun test          # expect: 987 pass, 0 fail
bun run lint      # biome check . — expect: clean
bun run typecheck # tsc --noEmit — expect: clean
```

## 1. Refresh entities across the whole mirror (US1, US2)

```bash
bun run src/cli/danni.ts curate --entities-only
# stdout: a single JSON line, the RunCurateResult, e.g.:
# {"curated":0,"uncurated":0,"entitiesAttached":<N>,"linksCreated":<M>,"translationsWritten":0,"relationsCreated":<K>}
```

**Acceptance check (FR-001/FR-002/FR-003, SC-001/SC-002/SC-003)**:

- `curated === 0` and `uncurated === 0` — no resource was parsed (the parse loop is skipped).
- `translationsWritten === 0` — no translation was attempted; **no translator was constructed**,
  so the run needs no LAN access to the translation backend.
- `entitiesAttached > 0` — dataset→entity edges (incl. publisher-derived places) were re-asserted.
- Resident memory stays bounded (≈140 MB RSS) and the run completes the full catalog instead of
  being OOM-killed partway (the failure mode of a full `danni curate` on the live mirror).

Combine with the existing scoping flags as usual:

```bash
bun run src/cli/danni.ts curate --entities-only --datasets <id1,id2>
bun run src/cli/danni.ts curate --entities-only --since 2026-06-01T00:00:00Z
bun run src/cli/danni.ts curate --help
# danni curate [--datasets <id1,id2,...>] [--since <iso>] [--curator-version <v>] [--entities-only]
```

## 2. Verify the run-level guard (the unit test) (FR-001–FR-005)

The unit test seeds a captured, parse-able resource (which a full run WOULD parse), supplies a
translator (which entities-only must ignore), and runs `runCurate({ entitiesOnly: true })`:

```bash
bun test tests/unit/curate/run-curate.test.ts
# expect: the '--entities-only re-extracts entities without parsing resources or translating'
#         test passes, asserting:
#   out.curated === 0, out.uncurated === 0, out.translationsWritten === 0
#   CuratedArtifactsRepo.byDataset('d1').length === 0   (no artifacts written)
#   out.entitiesAttached > 0
#   dataset_entities contains geo:bg-municipality-stolichna  (publisher 'Столична община' → place)
```

**Acceptance check (FR-005)**: the publisher-derived place is attached even though no resource was
parsed — proof that extraction reads dataset/resource **metadata rows**, not the parsed artifacts.

## 3. Verify idempotency over the whole catalog (US3, FR-006, SC-004)

Run it twice and confirm the entity/link/relation row sets do not grow:

```bash
bun run src/cli/danni.ts curate --entities-only   # first run
bun run src/cli/danni.ts curate --entities-only   # second run, no source changes
# The dataset_entities / dataset_links / entity_relations row sets are identical after both runs:
# all writes are PK-guarded INSERT OR REPLACE
#   dataset_entities    PK (dataset_id, entity_id, extractor)
#   dataset_links       PK (dataset_a_id, dataset_b_id, via_entity_id, heuristic)
#   entity_relations    PK (subject_id, predicate, object_id)
```

Because a place can match both in-content and via publisher, `dataset_entities` keeps **one row per
extractor** (the PK includes the extractor); the read layer takes the **max confidence** per
`(dataset, entity)`, so the stronger in-content match wins downstream. Re-running re-asserts the
same rows — no duplicates, no growth.

## Success-criteria checklist (from spec §Success Criteria)

- **SC-001**: step 1 — entities-only completes the full live-mirror catalog (~16k resources)
  without OOM, at ≈140 MB RSS (vs ≈20 GB for the full re-curate).
- **SC-002**: steps 1 + 2 — `curated === 0`, `uncurated === 0`, `translationsWritten === 0`,
  `entitiesAttached > 0`, zero new `curated_artifacts` rows.
- **SC-003**: steps 1 + 2 — a supplied translator writes zero translations (ignored), and
  `danni curate --entities-only` succeeds with no translation backend reachable.
- **SC-004**: step 3 — re-running over an unchanged store leaves `dataset_entities` /
  `dataset_links` / `entity_relations` row sets identical.
- **SC-005**: step 0 — full suite green (987 pass / 0 fail), lint + typecheck clean.
