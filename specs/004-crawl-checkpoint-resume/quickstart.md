# Quickstart — Resumable full-portal crawl (004-crawl-checkpoint-resume)

> **Audience**: an operator running a long, batched, resumable crawl of data.egov.bg.
> Assumes the base mirror is already set up (see `specs/001-egov-data-sync/quickstart.md`)
> and `danni.config.json` has `portal.api = "egov-bg"`.

## 0. Prerequisites

- The base quickstart completed (Bun ≥ 1.x, config with an identifying `crawler.userAgent`).
- Store initialized and the new checkpoint migration applied:

```bash
bun run db:migrate          # idempotent; applies 006_crawl_checkpoint.sql (or its renumbered prefix)
```

Confirm the checkpoint tables exist:

```bash
sqlite3 store/danni.sqlite ".tables" | tr ' ' '\n' | grep crawl_checkpoint
# expect: crawl_checkpoint_datasets  crawl_checkpoint_resources  crawl_checkpoints
```

## 1. Start a bounded full-portal campaign

Run the whole portal in dataset-bounded batches. `--max` is the per-session **dataset** count;
the cursor is persisted so the next run continues where this one stopped.

```bash
bun run danni sync --max 200          # session 1: first 200 in-scope datasets (egov path)
```

Expect on stdout a one-line JSON summary, and (now that egov runs inside the Sync Run
machinery) a manifest + a `sync_runs` row:

```bash
ls store/manifest/                    # a new <run_id>.json for this session
bun run danni status --limit 1        # summaryOutcome, totals for the session
```

Inspect the checkpoint cursor + progress:

```bash
sqlite3 store/danni.sqlite \
  "SELECT scope_hash, cursor_uri, total_datasets, status FROM crawl_checkpoints;"
```

## 2. Continue across sessions (US2 — exact-once coverage)

Re-run with the same scope; the session resumes after the cursor:

```bash
bun run danni sync --max 200          # session 2: next 200 datasets
bun run danni sync --max 200          # session 3 ... repeat until status='completed'
```

Coverage check (SC-002 — every in-scope dataset visited exactly once, no gaps/dupes):

```bash
sqlite3 store/danni.sqlite \
  "SELECT outcome, COUNT(*) FROM crawl_checkpoint_datasets GROUP BY outcome;"
# sum across outcomes == total_datasets; no dataset_uri appears twice (enforced by PK)
```

When the cursor passes the last frozen id, `status` flips to `completed`.

## 3. Resume after an interruption (US1 — no redone work)

Simulate an interruption: stop a running session (Ctrl-C / kill). The abandoned run is reaped
on the next invocation (`reapAbandonedRuns`) and the lock is released. Re-invoke:

```bash
bun run danni sync --max 200
```

Acceptance checks:
- **SC-001 (< 1% re-fetch)**: already-captured-and-unchanged resources are skipped — compare
  the captured count in this session's manifest against a known-captured baseline; it should
  reflect only the in-flight dataset's remaining resources plus new datasets.
- **SC-004 (≤ 1 in-flight resource lost)**: at most one resource (the one being written when
  interrupted) is re-fetched on resume.
- **SC-003 (corpus/checkpoint consistency)**: no resource is marked `success` without its
  bytes on disk:

```bash
sqlite3 store/danni.sqlite \
  "SELECT dataset_uri, resource_uri FROM crawl_checkpoint_resources WHERE outcome='success';" \
  | while IFS='|' read -r d r; do
      test -f "store/raw/$d/$r/raw.csv" -o -f "store/raw/$d/$r/raw.json" \
        || echo "MISSING bytes for success row: $d/$r";
    done
# no MISSING lines == SC-003 holds
```

## 4. Re-invoke after full completion (SC-005 — zero captures)

With a `completed` campaign and no upstream changes:

```bash
bun run danni sync --max 200
# JSON summary shows captured: 0; status reports the corpus up to date
```

Every dataset's validator matches `datasets.source_etag_or_hash` and every checkpoint resource
is `success`, so no datastore is fetched.

## 5. Observe progress (US3 — FR-006)

```bash
bun run danni status                  # discovered / captured / failed / remaining for the campaign
```

`remaining` excludes capped failures (FR-009). Cross-check directly:

```bash
sqlite3 store/danni.sqlite \
  "SELECT
     (SELECT total_datasets FROM crawl_checkpoints LIMIT 1) AS total,
     SUM(outcome='complete') AS complete,
     SUM(outcome='failed')   AS failed,
     SUM(outcome='pending')  AS remaining
   FROM crawl_checkpoint_datasets;"
```

## 6. Retry recorded failures (FR-009)

A normal resume **skips** recorded failures (the cursor advances). To re-attempt them, bounded
by `max_attempts`:

```bash
bun run danni sync --retry-failed --max 200
```

Rows already at `attempts == max_attempts` are **not** retried (they stay in `remaining`'s
exclusion). Inspect:

```bash
sqlite3 store/danni.sqlite \
  "SELECT dataset_uri, attempts, last_failure_reason
   FROM crawl_checkpoint_datasets WHERE outcome='failed';"
```

## 7. Mutual exclusion with the CKAN path (FR-007 / 001 FR-017c)

egov now shares the single `sync_runs_lock`. Starting a second sync (egov or CKAN) while one
holds the lock is rejected with exit code 5:

```bash
bun run danni sync --max 200 &        # holds the lock
bun run danni sync --max 50           # rejected: "sync rejected: sync-run lock is already held ..."
echo $?                               # 5
wait
```

## 8. Lost-checkpoint degradation (FR-008)

Simulate a lost checkpoint and confirm a safe re-scan that still avoids re-downloading
already-present bytes:

```bash
sqlite3 store/danni.sqlite "DELETE FROM crawl_checkpoints;"   # also cascades the child rows
bun run danni sync --max 200
# the crawl re-scans, rebuilds the checkpoint, and reuses on-disk content (no re-download
# for unchanged resources already present under store/raw/...)
```

## Acceptance checklist (maps to Success Criteria)

| Check | Command in this guide | Criterion |
|---|---|---|
| Resume re-fetches < 1% of captured-unchanged resources | §3 | SC-001 |
| Multi-session run covers every dataset exactly once | §2 | SC-002 |
| No `success` row without its bytes on disk | §3 | SC-003 |
| Interruption loses ≤ 1 in-flight resource | §3 | SC-004 |
| Post-completion re-invoke does zero captures | §4 | SC-005 |
| Progress visible; safe stop + clean resume | §3, §5 | FR-006 |
| Capped failures excluded from remaining; `--retry-failed` works | §6 | FR-009 |
| egov + CKAN mutually exclusive under one lock | §7 | FR-007 |
| Lost checkpoint degrades to safe re-scan | §8 | FR-008 |

## Notes

- The crawl respects the existing rate limiter, concurrency cap, backoff, robots, and
  User-Agent unchanged (Constitution XI) — resume only **reduces** requests.
- Off-peak (overnight Europe/Sofia) is still recommended for large campaigns.
- The CLI flag surface added by this feature: `--retry-failed`; `--max` keeps its meaning
  (per-session dataset batch) but now persists the cursor across sessions.
