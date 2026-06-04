# Live-portal scale capture (T125)

This document is the operator runbook for the **live-discovery smoke** required by
Research item R8. It is intentionally *not* part of the CI pipeline — capture the numbers
on a fresh machine and commit the result table here.

> **Portal API note.** data.egov.bg does **not** serve the CKAN API at `/api/3/action/`
> (every method returns "Непознат метод"), and its `robots.txt` is `Disallow: /`. A live
> capture therefore requires the **egov-bg adapter** with an operator robots opt-out — the
> default example config (`portal.api: "ckan"`, `obey: true`) cannot mirror the live portal.
> The portal currently reports **11,856 datasets** (`listDatasets.total_records`), and each
> `getResourceData` call carries real server latency (~10–15 s observed), so a full bootstrap
> is a long, multi-session run. Use `--max <n>` to capture a bounded, **resumable** sample.

## Procedure

1. Start from a clean checkout with dependencies installed (`bun install`).
2. Provision a fresh `store/` (or keep an existing one to resume a campaign).
3. Create a `danni.config.json` (gitignored) for the live egov-bg API with the robots opt-out:

   ```jsonc
   {
     "portal": { "baseUrl": "https://data.egov.bg/api/", "api": "egov-bg", "apiKeyEnv": null },
     "crawler": {
       "userAgent": "danni-bg/0.1.0 (+https://github.com/feedback-loop-ai/danni-bg)",
       "rateLimit": { "requestsPerSecondPerHost": 5 },
       "concurrency": { "maxConcurrentRequestsPerHost": 6 },
       "backoff": { "initialMs": 500, "maxMs": 60000, "failureBudget": 20 },
       "robots": { "recheckIntervalSeconds": 86400, "obey": false, "allowHosts": ["data.egov.bg"] }
     },
     "store": { "root": "./store", "freshnessSloSeconds": 86400 },
     "scope": {}
     // … schedule / enrichment / index as in danni.config.example.json
   }
   ```

4. Run a bounded, resumable capture session (repeat to advance the frozen cursor toward the
   full portal; the campaign is keyed by scope-hash and survives interruption):

   ```sh
   bun run db:migrate
   bun run danni sync --max 100        # capture up to 100 more datasets this session
   ```

5. Capture the numbers and on-disk size:

   ```sh
   bun run danni status                # recentRuns + crawlCampaigns (discovered/captured/failed, cursor)
   du -sb store/raw | awk '{print $1}'  # total raw bytes
   ```

> **Throughput note.** The binding constraint is per-request server latency, not the rate cap,
> so wall-clock scales with `maxConcurrentRequestsPerHost` more than `requestsPerSecondPerHost`.
> Raising concurrency 2 → 6 roughly halved the per-dataset time while staying gentle on the
> public API. The one-time enumeration of all ~11,856 dataset URIs (to freeze the resume cursor)
> is paid once per session.

## Captured metrics

Fill out this table after each operator-run capture. Do **not** commit auto-generated rows.

| Captured-on (UTC) | Datasets discovered | Resources captured | Total raw bytes | Wall-clock seconds | Failure rate | Notes |
|-------------------|---------------------|--------------------|-----------------|--------------------|--------------|-------|
| 2026-06-04 | 100 (of 11,856) | 262 / 299 | 99,802,734 (~95 MiB) | ~1,508 (2 sessions) | 12.4% (37/299) → ~0% post-fix | First live capture. Bounded `--max` sample via the egov-bg adapter + robots opt-out. All 37 failures were empty-datastore resources (`{"success":true}` with no `data`); the empty-datastore fix on this branch reclassifies them as valid empty captures, so a re-run lands ≥95% (SC-001). Concurrency raised 2 → 6 between the two sessions. |

The `wall-clock seconds` column drives the SC-002 budget: a re-sync over an unchanged
portal must complete in < 10% of the bootstrap wall-clock time. The back-to-back re-sync
number is not yet measured (only forward sessions were run); record it on the next capture.

## Why this is not in CI

CI runs against fixtures so that every PR is fast and reproducible. Live-portal numbers
depend on portal load, network conditions, and respectful-crawler defaults — they are
operational data, not a unit of correctness. The mechanism is asserted in CI; the rate is
asserted here.
