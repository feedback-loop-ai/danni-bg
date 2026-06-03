# Portal HTTP Fixtures

This directory holds recorded data.egov.bg HTTP responses used by the contract + integration test suites. Fixtures are committed verbatim — no live network is touched in CI.

## Recording procedure

Each fixture in this directory was either:

1. **Captured live** by running `tests/scripts/record-portal-fixtures.ts` against `https://data.egov.bg/api/3/action/`, or
2. **Hand-synthesized** to exercise a specific edge case (e.g. a Cyrillic title, a missing-resource scenario, a resource URL on a different host than the catalog API). Synthesized fixtures are still validated against the same Zod schemas in `src/crawler/ckan-schema.ts` to guarantee shape parity.

Synthesized fixtures cover:

- Standard CKAN package (`package_show/standard.json`)
- Cyrillic-only titles + descriptions (`package_show/cyrillic.json`)
- A dataset with no resources (`package_show/no-resources.json`)
- A dataset with resources hosted off-portal (`package_show/off-portal-resources.json`)
- Error envelope (`package_show/not-found.json`)
- Paginated `package_search` (`package_search/page-1.json`, `page-2.json`)

When a real-portal divergence is observed (live smoke task T125), the corresponding fixture is updated **and** the upstream change is recorded in `specs/portal-api/scale.md`.
