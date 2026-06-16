# Quickstart: Materializing publisher-derived geographic recall

**Feature**: `014-publisher-geo-recall` | **Status**: Implemented (PR #19)

The recall change is **code-only** at merge time. To realize it on an existing
mirror you must re-run entity extraction so the new
`BgAdminPublisherExtractor` runs over every dataset's publisher.

## Prerequisites

- A synced + curated mirror (datasets, resources, and **organisations** present
  in the local store — the extractor reads `org.title_bg` via the publisher id).
- The merged code from PR #19 (the extractor is registered in
  `src/curate/run-curate.ts`).

## Materialize on the whole mirror (recommended)

Re-run **only** entity extraction + cross-dataset linking — this skips
re-parsing every captured resource file, which is the expensive,
memory-hungry part of a full re-curate:

```bash
danni curate --entities-only
```

What this does:

- For each active dataset, runs all extractors over dataset/resource
  **metadata** rows (not parsed artefacts), including the new publisher
  extractor.
- Re-attaches geographic entities; publisher-derived placements appear with
  `evidence.source = 'publisher'`.
- Re-links datasets that now share a geographic entity and re-materializes the
  oblast roll-up relations.

> Why `--entities-only`: extraction reads metadata only, so a full re-curate
> (which re-parses every captured file) is unnecessary for a gazetteer/extractor
> change and can exhaust memory on a mirror of this size. This entities-only
> path is provided by feature 015.

## Materialize for a subset (spot-check)

```bash
danni curate --entities-only --datasets <id1>,<id2>,...
```

## Verify the effect

After the re-curate, the non-georeferenced "national" grouping should shrink
dramatically:

- National bucket: ~6,721 → ~1,776 datasets (56.7% → 15.0%).
- Georeferenced datasets: ~5,133 → ~10,078 (~85% of the mirror).

Spot-check a single dataset whose own title names no place but is published by a
municipal/regional org (e.g. published by "Община Бургас"):

- It should now carry a `geographic_unit` attachment for the Бургас municipality
  with `extractor = bg_admin_publisher` and `evidence.source = 'publisher'`.
- It should appear under Бургас (and its parent oblast) in the map's region
  view rather than only in the national grouping.

A dataset published by a national org (e.g. "Министерство на финансите") that
names no place should still carry **no** geographic attachment and remain in the
national grouping.

## Run the tests

```bash
# Unit: all four branches of the publisher extractor
bun test tests/unit/enrich/extractors/bg-admin-publisher.test.ts

# Integration: enrichment guarantees, incl. SC-011 recall effect
bun test tests/integration/enrichment-guarantees.test.ts
```

Expected: the Sofia cohort grows 3 → 6 datasets (org-sofia also publishes
d07/d08/d11, which name no place), and the shared-municipality clique grows
3 → 15 cross-dataset links.
