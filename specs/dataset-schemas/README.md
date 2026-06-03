# Dataset Schema Catalog

This directory is the **authoritative per-dataset schema catalog** required
by Constitution Principle III. It grows as the crawler encounters new
datasets and the curator infers their canonical schema.

## Status

**Bootstrapped on 2026-05-08** as part of feature `001-egov-data-sync` (Phase
1 design). At this point only this README exists. Each entry will be added
once the corresponding curated artifact has been produced and a fixture-based
round-trip test exists for it (Constitution VIII: Dataset Schema Parity).

## Catalog entry layout

```
specs/dataset-schemas/<dataset-slug>/
├── README.md             # Human-readable description of the dataset
├── schema.json           # Conforms to contracts/curated-tabular-artifact.schema.json
│                         # (or a curated-non-tabular variant when added)
├── fixtures/
│   ├── source.<ext>      # Original byte-faithful sample (small)
│   └── curated.ndjson    # Curated round-trip output for that sample
└── notes.md              # Quirks, encoding history, normalization decisions
```

## Inclusion rule

A dataset enters the catalog **only after**:

1. The crawler has captured at least one resource for it.
2. The curator has produced a curated artifact (i.e. `kind != 'uncurated'`).
3. A round-trip parity test exists under `tests/contract/dataset-parity/`
   that loads `fixtures/source.<ext>`, runs it through the curator, and
   asserts the output equals `fixtures/curated.ndjson` byte-for-byte.

The parity matrix (`tests/parity-matrix.json`) MUST list every catalog entry
with its parity test path; CI fails if an entry has no test.

## Cyrillic preservation

Schema entries that include sample values MUST preserve Cyrillic exactly
(Principle X). Tests assert byte-exact equality; transliteration in fixtures
is forbidden.
