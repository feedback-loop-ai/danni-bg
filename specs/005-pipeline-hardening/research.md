# Phase 0 Research — 005-pipeline-hardening

**Date**: 2026-06-04
**Status**: Implemented. Records the decisions behind the shipped, verified work.

This feature is a **retrofit**: the five fixes were batched, implemented, and verified
(737 pass / 0 fail, lint + typecheck clean, parity-matrix + migrate-smoke gates green)
*before* this artifact was written. There were no clarification rounds — the unknowns were
not "what should the behavior be" (the audit pinned that) but "how to land five cheap,
high-leverage correctness/process fixes without a schema change, a new external contract, or
collateral churn". There is **no new migration** and **no `contracts/` directory** (exactly
like 002 and 003): the index-entry schema is unchanged, and only the *emitted value* of an
already-described field is corrected. Each decision below is in the canonical
**Decision / Rationale / Alternatives considered** form and is grounded in the code actually
read (`src/index/query.ts`, `src/crawler/portal-sync.ts`, `src/cli/{search,index-cmd,sync,schedule}.ts`,
`src/index/embedders/local-onnx.ts`, and the three new/strengthened tests).

---

## R1 — `curatedDatasetPath` granularity: the dataset's curated *directory*, grounded in real artifact rows

**Decision**: `curatedDatasetPath` is the **relative path of the dataset's curated
directory** under `store/curated/`, never a single per-resource file and never an absolute
path. It is derived from the dataset's actual `curated_artifacts` rows: `search()` and
`searchByEntity()` call `resolveCuratedDatasetPath(artifacts, datasetId)`
(`src/index/query.ts`), which reads `CuratedArtifactsRepo.byDataset(datasetId)`, takes the
first artifact with a non-empty `path`, and returns that path's **top segment** (split on
`/` or `\`). When the dataset has no curated artifacts yet, it falls back to the dataset id
— which *is* the canonical curated directory by the on-disk layout. The contract test
(`tests/contract/index-entry.test.ts`) was tightened past `z.string()` to assert the value
is relative (`startsWith('/') === false`) and, for the no-artifact case, equals the dataset
id (`'d1'`); the e2e test asserts it resolves on disk via
`existsSync(join(storeRoot, 'curated', hit.curatedDatasetPath))`.

**Rationale**: The "curated dataset record" is the composed `mirror-info` / `datasetView`
object surfaced by `danni mirror-info` — it is *never persisted as one file on disk*. What
lives on disk is the per-resource artifact tree at `<datasetId>/<resourceId>/data.*`
(`curated_artifacts.path`). So the only thing a single relative path can faithfully point at,
at *dataset* granularity, is the **directory** holding those per-resource artifacts; a
consumer enumerates the resources within it. By that layout the directory's relative path
equals the dataset id. The old code emitted the dataset id *incidentally* (it had it in
hand); the fix derives the same string from a **real artifact row's** path top-segment, so
the pointer is now *grounded and validated against actual on-disk output* rather than
asserted, and the contract test can be tightened to prove it. `byDataset` orders by
`created_at` and the resolver takes the first non-empty `path`, so a multi-resource dataset
still yields the one shared parent directory (all resources sit under `<datasetId>/`).

**Alternatives considered**:
- *Emit a primary per-resource file* (e.g. the first `data.csv`): rejected — arbitrary for a
  multi-resource dataset (which resource is "primary"?) and semantically wrong: the field is
  the *dataset* path, not a *resource* path. It would also break the moment a dataset's
  resource set changed.
- *Write a new dataset-level record file to disk and point at it*: rejected — a materially
  larger change (a new curator output, its own write/cleanup lifecycle, a schema/contract
  touch) for no consumer benefit over pointing at the directory that already exists. Out of
  scope for a correctness retrofit (Principle V / YAGNI).
- *Keep the incidental dataset-id string with no artifact lookup*: rejected — it happened to
  be correct but was ungrounded; nothing tied it to real curated output, so the contract
  test could only assert "a string". Joining `curated_artifacts` is what makes the assertion
  (and the value) trustworthy (FR-001, FR-003, SC-001).

---

## R2 — Warn at the CLI boundary, not in the embedder constructor

**Decision**: The stub warning lives in `buildEmbedder()` in **both** `src/cli/search.ts`
and `src/cli/index-cmd.ts`. `LocalOnnxEmbedder` gains a read-only `isStub` boolean
(`src/index/embedders/local-onnx.ts`) — `true` exactly when no `embedFn` was injected. The
CLI reads `embedder.isStub` after constructing the embedder and, when true, writes one
`warning:` line to **stderr** naming the stub model id (`embedder.id`, e.g.
`local-onnx:hash-stub-32`) and stating that semantic ranking is not meaningful. The
constructor itself never warns. An injected real `embedFn` sets `isStub = false`, so the
warning never fires for tests or a real model.

**Rationale**: The constructor is used legitimately by *many* tests with the deterministic
stub (e.g. `new LocalOnnxEmbedder({ dimension: 8 })` in the contract and e2e tests). Warning
in the ctor would spam those suites and, worse, *mislead* — a test deliberately using the
stub is not a misconfiguration. Exposing the state as `isStub` and letting the **operator-
facing CLI** decide to warn keeps the policy where the human is (FR-007: "the warning lives
at the CLI boundary, not in the embedder ctor"). Stderr (not stdout, not a result field) is
the channel because the index-entry schema is **closed** (`additionalProperties: false`) and
the model id is *operator advice*, not part of the machine-readable result; putting it on
stdout would also corrupt `danni index`'s `JSON.stringify(result)` output and `danni search
--json`. SC-003 is met: exactly one stub line per invocation on the default `local-onnx`
config, including `local-onnx:hash-stub-32`.

**Alternatives considered**:
- *Warn in the `LocalOnnxEmbedder` constructor*: rejected — fires for every test that
  legitimately constructs the stub, conflating "test fixture" with "production
  misconfiguration", and would need a suppression flag that just re-creates the boundary
  decision one layer deeper.
- *Add a `stubWarning`/`modelId` field to `IndexEntry`*: rejected — the schema is closed and
  unchanged by design (R6); a per-result field also misplaces a once-per-invocation operator
  advisory and would repeat on every hit.
- *Warn from inside `search()`/`runIndex()`*: rejected — those are library functions called
  by tests and (future) embedders with injected real `embedFn`; the warning belongs at the
  process boundary that owns stderr and knows it is a human-driven CLI run.

---

## R3 — One shared dispatch (`runPortalSync`) instead of two drifting branches

**Decision**: A new internal module `src/crawler/portal-sync.ts` owns portal selection.
`runPortalSync(opts)` reads `config.portal.api` and returns a discriminated union —
`{ api: 'egov-bg'; result }` (builds `EgovBgClient` + `runEgovSyncRun`) or
`{ api: 'ckan'; result }` (builds `CkanClient` + `runSync`). Both `src/cli/sync.ts` and
`src/cli/schedule.ts` were rewired onto this single function; neither constructs a portal
client directly anymore. Each entry point preserves its pre-existing exit-code semantics:
the egov path emits its run JSON to stdout and exits `3` on `summaryOutcome === 'failed'`
else `0`; the ckan path exits `0` on `success` else `3`; the scheduler keeps overlap-skip →
exit `5`.

**Rationale**: The bug existed *precisely because* `schedule.ts` had drifted from `sync.ts`:
the scheduler hardcoded `CkanClient`, so a scheduled crawl configured for the live portal
(`portal.api = 'egov-bg'`) silently issued CKAN `/api/3/action/` calls that all fail with
"Непознат метод" — it could never capture anything. Centralizing the client+runner choice in
one function makes that class of drift *structurally impossible*: there is exactly one place
that maps `portal.api` to a client and runner, and both entry points go through it (FR-004,
FR-006). The `portal-sync.test.ts` dispatch tests lock this in — an `egov-bg` config hits
`listDatasets` and never `package_search`, a `ckan` config hits `package_search` and never
`listDatasets` (SC-002).

**Alternatives considered**:
- *Fix `schedule.ts` in place* (swap its hardcoded `CkanClient` for an `if (api === ...)`
  branch): rejected — re-introduces a second copy of the dispatch logic, which is exactly the
  thing that drifted; a future third entry point would have to remember to update both.
- *Push portal selection down into a single client factory but keep two runners*: rejected —
  the *runner* differs too (`runEgovSyncRun` is the resumable campaign runner;
  `runSync` is the standard CKAN runner), so a client-only factory would still leave the
  runner choice duplicated. The union returns the runner-specific result so callers keep
  their distinct exit-code semantics.

---

## R4 — `buildPortalHttp` centralizes the robots opt-out; optional injected fetcher for offline tests

**Decision**: A second exported helper, `buildPortalHttp(config, fetcher?)`
(`src/crawler/portal-sync.ts`), builds the whole HTTP stack — `RateLimiter`,
`BackoffRunner`, and a `RobotsCache` constructed with `obey: config.crawler.robots.obey` and
`allowHosts: config.crawler.robots.allowHosts` — and returns a `PortalHttp`. Both `sync.ts`
and `schedule.ts` build their HTTP through it, so the robots opt-out is applied identically
on both paths. `buildPortalHttp` accepts an **optional** `fetcher` that is threaded into
`PortalHttp` only when provided, so the dispatch tests inject a recording fetcher.

**Rationale**: The live `data.egov.bg` API serves `robots.txt: Disallow: /`, so an
authorized crawl *requires* the operator opt-out (`crawler.robots.obey` /
`crawler.robots.allowHosts`). The scheduler previously omitted those fields entirely when it
built its own HTTP, so even after dispatch was fixed it would have re-imposed `Disallow: /`
and captured nothing (FR-005). The opt-out wiring is the three `RobotsCache` lines mirroring
the already-tested `sync.ts` path; rather than re-test the robots behavior here, that wiring
is covered by the existing `respectful-crawler` suite, and the new `portal-sync` dispatch
tests stay fully **offline** by setting `crawler.robots.obey = false` in the test config —
which short-circuits the robots check inside `RobotsCache` (it returns early, never fetching
`robots.txt`). The injected fetcher only ever sees the portal-API URLs, so the tests need no
network and no `robots.txt` fixture (FR-004 testability).

**Alternatives considered**:
- *Build the `RobotsCache` inside `runPortalSync`*: rejected — the HTTP stack must persist
  *across* scheduler fires (the rate limiter and backoff carry state between runs), so it is
  built once by the caller and passed in; folding it into the per-run dispatch would rebuild
  it every fire and reset that state.
- *Always require an injected fetcher*: rejected — production has no fetcher to inject; making
  it optional lets `PortalHttp` default to `fetch` in production while staying injectable for
  offline tests (the same pattern the rest of the crawler already uses).
- *Re-test the robots opt-out in `portal-sync.test.ts`*: rejected — it is identical wiring to
  the path `respectful-crawler` already exercises; duplicating that coverage adds a network/
  fixture dependency for no new assurance. The dispatch tests assert the *dispatch*, the
  thing that was actually broken.

---

## R5 — Bulk task-checkbox reconciliation against the green suite + audit, with a provenance note

**Decision**: The unchecked-but-implemented task boxes in `002/003/004` `tasks.md` were
checked **in bulk** against the green test suite and the subsystem audit (which spot-checked
task → code mapping), not re-derived task-by-task. Each `tasks.md` carries a
`Status (2026-06-04): Implemented` provenance note recording that the reconciliation was done
this way, and each "Implementation status" line was flipped from "Not started" to "Complete".
Specs `001–004` had their `Status` field moved to a terminal value. `001` keeps its two
items (T127 / T133) as *recorded decisions*, not pending work.

**Rationale**: The audit established that the shipped code matches these specs and that the
full suite passes; re-deriving each individual checkbox by re-reading every task against every
file would be expensive and add no assurance beyond what green tests + the audit already give
(FR-009). The provenance note is the honest record of *how* the boxes were reconciled, so a
later reader does not mistake a bulk flip for a line-by-line re-verification. SC-005 is met:
specs `001–004` show a terminal `Status` and `002/003/004` have zero unchecked-but-implemented
task boxes.

**Alternatives considered**:
- *Re-verify every task box individually*: rejected — high cost, no marginal assurance over
  the green suite + audit, and it would still rest on the same evidence. The provenance note
  makes the cheaper method auditable instead of hiding it.
- *Leave the boxes unchecked and only flip the spec `Status`*: rejected — the drift the
  retrofit set out to fix is precisely that the task records lagged the shipped code; leaving
  the boxes unchecked would perpetuate it.
- *Silently bulk-check without a note*: rejected — it would misrepresent a bulk flip as a
  per-task re-verification and erase the reconciliation method from the record.

---

## R6 — No new migration and no new external contract

**Decision**: The feature ships **no** migration and **no** `contracts/` directory. The
index-entry contract (`contracts/index-entry.schema.json`, consumed via
`src/index/query.ts`) is unchanged — no field added or removed, `additionalProperties: false`
intact. The only contract-adjacent change is the *strengthened test* and the corrected
*emitted value* of `curatedDatasetPath`; the schema already described that field as a
"relative path under `store/curated/`". The `matchedEntities[].kind` / `.label` fields
likewise already existed in the schema; the fix populates them from the real `EntitiesRepo`
row instead of the previous `kind: 'unknown'` / empty-label placeholder (FR-002).

**Rationale**: Every change in this retrofit is a *correctness* fix to make emitted values
honor their already-published descriptions, plus internal wiring (`portal-sync.ts`) and a new
boolean on an existing class (`LocalOnnxEmbedder.isStub`). None of that touches persisted
schema, so there is nothing to migrate and no external contract surface changes shape (FR-006,
R6). This mirrors features 002 and 003, which also shipped without a `contracts/` directory —
noted explicitly in this feature's spec and plan so a reader does not expect one. The
`migrate-smoke` gate stays green precisely because no migration was added.

**Alternatives considered**:
- *Add a migration to persist the curated dataset directory as a column*: rejected — the path
  is **derivable** at query time from `curated_artifacts` (R1); persisting it would duplicate
  authoritative state and invite drift, for no read-path benefit.
- *Bump the index-entry schema (e.g. add a `modelId`/`stubWarning` field)*: rejected — the
  schema is closed by design and the stub advisory belongs on stderr (R2); the corrected
  `curatedDatasetPath` and populated entity labels are already in-schema, so honoring the
  existing description is sufficient.
