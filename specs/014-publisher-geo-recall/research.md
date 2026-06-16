# Research: Publisher-derived geographic recall

**Feature**: `014-publisher-geo-recall` | **Date**: 2026-06-15 | **Status**: Implemented (PR #19)

This document records the measurement that justified the feature, why a known
fraction of the national bucket is recoverable (and the rest is not), and the
rationale for the confidence ordering and extractor precedence.

## 1. The problem, measured

The map explorer (feature 008) places datasets on Bulgarian administrative
units via geographic entities the curation pipeline extracts. Datasets with no
geographic entity have nowhere to sit and collapse into one non-georeferenced
"national" grouping.

On the live mirror this bucket dominated:

| Metric | Before | Share |
|--------|-------:|------:|
| Total datasets in mirror | 11,854 | 100% |
| Datasets with **no** geographic entity (national bucket) | 6,721 | 56.7% |
| Georeferenced datasets | 5,133 | 43.3% |

A map where the largest "region" is an opaque 56.7% pile is not representative
of the corpus. The question was whether that bucket reflects *genuinely
national* data or a *recall gap*.

## 2. Why 73.6% of the national bucket is recoverable

The in-content extractor (`BgAdminGazetteerExtractor`) scans only a dataset's
**own** title, description, and resource names. It never looked at the
**publisher**. But Bulgarian municipal and regional bodies name the place in
their *organisation* name even when individual datasets do not:

- `Община Бургас` → Бургас
- `Регионално управление на образованието - Пловдив` → Пловдив
- `Областна администрация - Варна` → Варна

Running the *same gazetteer* over the publisher organisation name across the
national bucket:

| National-bucket cohort | Count | Share of bucket |
|------------------------|------:|----------------:|
| Published by an org whose **name names a place** (recoverable) | 4,945 | 73.6% |
| Genuinely national publishers (ministries, НСИ, Сметна палата, national parks) | 1,776 | 26.4% |

So 73.6% of the bucket was a scoping gap, not a data gap: the place was sitting
in the publisher field the extractor never read.

## 3. Why the rest stays national (and must)

The residual 26.4% (~1,776 datasets) is published by organisations whose names
contain **no administrative place name**:

- Ministries (`Министерство на финансите`, `Министерство на здравеопазването`)
- The National Statistical Institute (`НСИ`)
- The Court of Audit (`Сметна палата`)
- National parks and other national-scope bodies

These are correctly national: a publisher-name gazetteer scan yields no match,
so the extractor attaches nothing and the dataset stays in the national
grouping. This is a feature, not a shortfall — the national bucket must keep
meaning "genuinely national" for it to be useful (SC-005). Manufacturing a
region for these would be a false placement.

## 4. Projected vs. realized effect

Applying publisher-derived recall and re-curating the mirror:

| Metric | Before | After | Change |
|--------|-------:|------:|-------:|
| National bucket | 6,721 (56.7%) | 1,776 (15.0%) | −4,945 |
| Georeferenced datasets | 5,133 (43.3%) | 10,078 (~85%) | +4,945 |

(9,899 total dataset placements are recovered via the publisher signal once
roll-up to parent oblasts is counted; the net national-bucket shrinkage is
4,945 datasets.)

## 5. Confidence-ordering rationale

A publisher affiliation is a **weaker** placement signal than a dataset naming
the place itself. A dataset titled "Качество на въздуха в Пловдив" is
unambiguously about Пловдив; a dataset merely *published by* Община Бургас is
*probably* about Бургас but could be a generic administrative artefact. The
confidence ladder encodes that:

| Source | Canonical match | Alias match |
|--------|----------------:|------------:|
| In-content (`BgAdminGazetteerExtractor`) | 0.95 | 0.75 |
| Publisher (`BgAdminPublisherExtractor`) | 0.70 | 0.60 |

The publisher *alias* ceiling (0.60) sits strictly below the in-content alias
floor (0.75), so **no** publisher match can ever outrank **any** in-content
match for the same place. A unit test asserts this invariant
(`Math.max(...publisherConfidences) < 0.75`).

## 6. Why precedence is handled by ordering + the existing key (not new machinery)

`dataset_entities` is keyed by `(dataset_id, entity_id, extractor)` and
`EntitiesRepo.attach` is `INSERT OR REPLACE`. Two consequences:

1. **Coexistence**: A publisher row (`bg_admin_publisher`) and an in-content row
   (`bg_admin_gazetteer`) for the same dataset and entity are *different* PK
   tuples, so both provenance rows persist — each retaining its own confidence
   and evidence. Nothing is destroyed.
2. **Precedence on read**: The read/region layer takes the maximum confidence
   per `(dataset, entity)` (and counts the pair once via `DISTINCT dataset_id`),
   so the stronger in-content confidence governs downstream.

Given (1) and (2), explicit extractor precedence in code is not strictly
required for correctness — but `BgAdminPublisherExtractor` is registered
**before** `BgAdminGazetteerExtractor` anyway, so that even under any pathway
that collapsed to a single row, the *last writer* (the in-content extractor)
would win. This was the simplest robust ordering and is documented inline in
`run-curate.ts`.

Alternatives rejected:

- **A `confidence`-aware upsert (keep-max) on a 2-column key** `(dataset, entity)`:
  rejected — it would discard provenance (which extractor / which evidence
  produced the placement) and add bespoke max-merge logic, violating Simplicity
  (V). The existing 3-column key already gives coexistence + a clean
  max-on-read.
- **A separate `publisher_geo` table**: rejected — placement is placement; a
  parallel table would fork the map's read path for no benefit.

## 7. Composition with the oblast roll-up (feature 013)

The roll-up materializes `municipality part_of oblast` relations globally over
whatever municipality entities are present, regardless of which extractor
attached them. A publisher-derived municipality is an ordinary municipality
entity, so it rolls up to its parent oblast automatically. No change was needed
in feature 013 for this to hold; the integration test confirms the Sofia cohort
(now including publisher-derived members) aggregates correctly.

## 8. Materialization cost

Because extraction reads dataset/organisation **metadata** rows — not parsed
resource artefacts — the recall is materializable corpus-wide via
`danni curate --entities-only`, which skips re-parsing every captured file (a
full re-curate can exhaust memory on a mirror of this size). This entities-only
curate path is the dependency from feature 015.
