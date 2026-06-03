# Live-portal scale capture (T125)

This document is the operator runbook for the **one-shot live-discovery smoke** required by
Research item R8. It is intentionally *not* part of the CI pipeline — capture the numbers
once on a fresh machine and commit the result table here.

## Procedure

1. Start from a clean checkout with the dependencies installed (`bun install`).
2. Provision a fresh `store/` (delete any prior `store/danni.sqlite`).
3. Run the one-shot live discovery against the real portal:

   ```sh
   bun run db:migrate
   bun run danni sync --once
   ```

4. After the sync terminates, capture the numbers:

   ```sh
   bun run danni status --json | jq '.[0]'
   ```

5. Total raw bytes on disk:

   ```sh
   du -sb store/raw | awk '{print $1}'
   ```

## Captured metrics

Fill out this table after each operator-run capture. Do **not** commit auto-generated rows.

| Captured-on (UTC) | Datasets discovered | Resources captured | Total raw bytes | Wall-clock seconds | Failure rate | Notes |
|-------------------|---------------------|--------------------|-----------------|--------------------|--------------|-------|
| —                 | —                   | —                  | —               | —                  | —            | First capture pending |

The `wall-clock seconds` column drives the SC-002 budget: a re-sync over an unchanged
portal must complete in < 10% of the bootstrap wall-clock time. Record both numbers on
back-to-back runs.

## Why this is not in CI

CI runs against fixtures so that every PR is fast and reproducible. Live-portal numbers
depend on portal load, network conditions, and respectful-crawler defaults — they are
operational data, not unit-of-correctness. The mechanism is asserted in CI; the rate is
asserted here.
