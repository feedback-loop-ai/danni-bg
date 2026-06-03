# Search query-set fixture

`query-set.json` drives `tests/integration/search-cross-lang.test.ts` (T121). It contains
≥20 BG/EN query pairs with the dataset IDs that should appear in the top-5 results.

## Selection rationale

Queries were selected to cover the categories listed in T121:

- **ministry-budget**: `общини бюджет` / `municipal budgets`
- **municipal registries**: `регистър` / `register`, `Столична община`
- **geo entities**: `София` / `Sofia`, `Пловдив` / `Plovdiv`
- **format-specific terms**: `geojson`
- **BG↔EN pairs**: every topic appears in both languages so the FTS5 + vector fusion is
  exercised symmetrically.

Each query carries a `rationale` field documenting why it was added; this lets a future
maintainer extend the set without losing the original intent.

## Coverage target (per T121, SC-004)

≥90% of queries must surface the expected dataset within the top 5 results across both
languages. The integration test reads this file, populates a small fixture corpus,
indexes it, runs each query, and asserts the rank.

## Adding a query

1. Append an object to `queries`. Required keys: `query`, `lang` (`bg` or `en`),
   `expected` (non-empty array), `rationale`.
2. Make sure the corresponding fixture dataset is part of the corpus seeded by the
   integration test. The dataset IDs above are seeded directly in the test setup
   (fixture-only — no portal HTTP).
