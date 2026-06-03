# Tabular curated schema

Tabular resources (CSV, TSV, XLSX) curate to `data.ndjson` + `schema.json` under
`store/curated/<dataset_id>/<resource_id>/`. The schema conforms to
[`contracts/curated-tabular-artifact.schema.json`](../001-egov-data-sync/contracts/curated-tabular-artifact.schema.json).

**Encoding**: always UTF-8 (FR-008). CP1251 source bytes are decoded and the choice is
recorded in `schema.transformRules` as a `utf8-from-windows1251` rule.

**Row format**: NDJSON — one JSON object per row, keyed by `column.canonicalName`.

**Column inference**: each column's `type` is inferred by `src/curate/schema.ts` over a
sample of values; `interpretationConfidence` records how strong the inference was.
Ambiguous columns retain alternates in `alternateInterpretations`.

**Round-trip parity test**: `tests/contract/curated-tabular-artifact.test.ts` —
registered in `tests/parity-matrix.json#datasetSchemas[name=tabular]`.

**Cyrillic preservation**: column `sourceName` carries the original header byte-exact
(Principle X). The `canonicalName` is a snake_case slug used as the JSON key in
`data.ndjson`.
