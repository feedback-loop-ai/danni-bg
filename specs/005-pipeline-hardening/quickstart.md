# Quickstart — Pipeline Correctness & Traceability Hardening (005)

> **Audience**: an operator (or reviewer) verifying that search hits are traceable
> to on-disk curated output, that the scheduler crawls the LIVE portal through the
> egov adapter, and that the deterministic semantic stub is no longer presented
> silently as a real embedder. This is a RETROFIT of already-shipped work
> (**Status: Implemented**, 2026-06-04); the steps below confirm the five fixes,
> not new behavior to enable. No new migration; no new external contract.

All commands run from the repo root with Bun installed.

## 0. Green gate (run this first and last)

The whole feature was added under a green suite. Confirm the three gates pass
before and after exercising the individual fixes:

```bash
bun test          # expect: 737 pass, 0 fail (was 734 before the three new suites)
bun run lint      # biome check . — expect: clean
bun run typecheck # tsc --noEmit — expect: clean
```

`bun test` also runs the constitution gates (parity-matrix + migrate-smoke);
they stay green because this feature consumes no new endpoint and ships no
migration.

## 1. Verify search traceability — the contract test (FR-001, FR-002, FR-003 · US1)

The index-entry contract test was tightened beyond `z.string()`: it now asserts
`curatedDatasetPath` is **relative** (does not start with `/`), equals the
dataset's canonical curated directory (`d1` for a dataset with no curated
artifact), and that `sourceUrl` round-trips the portal URL.

```bash
bun test tests/contract/index-entry.test.ts
# expect: 1 pass — search() output validates against the index-entry schema,
#         hit.curatedDatasetPath === 'd1', !startsWith('/'), sourceUrl === 'https://x/d1'
```

**Acceptance check (FR-001/FR-003)**: the emitted `curatedDatasetPath` is the
dataset's curated DIRECTORY (a relative path under `store/curated/`), derived
from the dataset's `curated_artifacts` rows, never an absolute path.

## 2. Verify the per-stage unit guard for portal dispatch (FR-004, FR-006 · US2)

The dispatch test is the regression guard for the scheduler bug: it drives the
shared `runPortalSync` for both portal APIs against an offline recording fetcher
and asserts each API hits only its own endpoints. `obey:false` short-circuits the
robots check so the test never fetches `robots.txt`.

```bash
bun test tests/unit/crawler/portal-sync.test.ts
# expect: 2 pass —
#   portal.api='egov-bg' → urls include listDatasets, NEVER package_search
#   portal.api='ckan'    → urls include package_search, NEVER listDatasets
```

**Acceptance check (SC-002)**: an egov-bg-configured dispatch issues egov
endpoints and ZERO CKAN calls; a ckan-configured dispatch issues `package_search`
and zero egov calls.

## 3. Verify the end-to-end safety net (FR-008 · US4)

A single test drives all five stages — sync → curate → enrich → index → search —
against one on-disk store, so a cross-stage contract drift fails here even when
every per-stage suite passes in isolation. It serves real CSV bytes and injects a
deterministic BG→EN translator (`test:prefix`, confidence 0.9) so the translation
handoff is observable in the final hit.

```bash
bun test tests/integration/pipeline-e2e.test.ts
# expect: 1 pass — captures, curates, enriches, indexes and returns a traceable,
#         readable search hit
```

**Acceptance check (SC-001 / FR-008)** — the test asserts, on the single hit for
dataset `00000000-0000-0000-0000-000000000001`:

- `hit.sourceUrl` contains `data.egov.bg` (one-hop traceability back to the portal);
- `existsSync(join(storeRoot, 'curated', hit.curatedDatasetPath))` is `true`
  (the relative `curatedDatasetPath` resolves to an on-disk curated directory);
- `hit.title.en === 'EN:Първи набор от данни'` (the injected translation flowed
  sync→curate→index→search);
- `searchByEntity(...)` returns the dataset and `matchedEntities[0].kind` is NOT
  `'unknown'` with a non-empty bilingual `label.bg` (FR-002 — real `EntitiesRepo`
  data, not the old hardcoded placeholder).

## 4. Observe the stub warning on the default config (FR-007 · US3)

When the embedder resolves to the deterministic `local-onnx` hash stub (no
injected `embedFn`), both `danni search` and `danni index` now print exactly one
stderr warning per invocation naming the stub model id `local-onnx:hash-stub-32`.
The warning lives at the CLI boundary (`buildEmbedder` in `search.ts` /
`index-cmd.ts`), reading `LocalOnnxEmbedder.isStub`; it does NOT fire for a real
injected `embedFn`, so tests and real models stay quiet.

Use a config whose `enrichment.embedder.provider` is `local-onnx` (the stub
provider). A minimal `danni.config.json`:

```json
{
  "portal": { "baseUrl": "https://data.egov.bg/api/3/action/", "api": "ckan" },
  "crawler": {
    "userAgent": "danni-bg/local",
    "rateLimit": { "requestsPerSecondPerHost": 1 },
    "concurrency": { "maxConcurrentRequestsPerHost": 1 },
    "backoff": { "initialMs": 100, "maxMs": 1000, "failureBudget": 3 },
    "robots": { "recheckIntervalSeconds": 86400, "obey": true, "allowHosts": [] }
  },
  "store": { "root": "store" },
  "schedule": {
    "enabled": false, "cron": null, "timezone": "Europe/Sofia",
    "onOverlap": "skip", "failureRateThreshold": 0.05,
    "notifier": { "kind": "stderr" }
  },
  "scope": {},
  "enrichment": {
    "translator": { "provider": "local-marianmt" },
    "embedder": { "provider": "local-onnx" }
  },
  "index": { "incremental": true }
}
```

Then run search (a populated store from the 001 quickstart is assumed; the
warning fires regardless of whether there are hits):

```bash
bun run src/cli/danni.ts search "набор" 2>warn.txt
cat warn.txt
# expect EXACTLY ONE stderr line, including the stub model id, e.g.:
# warning: embedder provider 'local-onnx' is a deterministic hash stub
#   (local-onnx:hash-stub-32) — semantic ranking is NOT meaningful; only the
#   FTS/keyword leg is real. Set enrichment.embedder.provider='hosted-api' ...
```

The same warning fires once for `danni index`:

```bash
bun run src/cli/danni.ts index 2>warn.txt
grep -c 'local-onnx:hash-stub-32' warn.txt
# expect: 1
```

**Acceptance check (SC-003)**: exactly one stub warning naming
`local-onnx:hash-stub-32` per invocation of `danni search` / `danni index` on the
default local-onnx config; switching `enrichment.embedder.provider` to
`hosted-api` (with an `endpointUrl`) emits no stub warning.

## 5. Verify the scheduler dispatches egov-bg through the shared path (FR-004, FR-005, FR-006 · US2)

The scheduler now builds its HTTP stack through `buildPortalHttp` (which applies
the robots opt-out — `crawler.robots.obey` / `allowHosts`) and fires through the
same `runPortalSync` as the interactive `sync` CLI, with `trigger:'scheduled'`.
Before this fix `schedule.ts` hardcoded `CkanClient` and omitted the robots
opt-out, so a scheduled crawl of the live portal silently issued CKAN calls that
all failed ("Непознат метод") and re-imposed `Disallow: /`.

Inspect the wiring (no live network call needed):

```bash
bun run src/cli/danni.ts schedule show
# with schedule.enabled=true + a cron set, prints the next fire time; the install
# path (schedule install) builds buildPortalHttp(config) once and fires
# runPortalSync({ ..., trigger: 'scheduled' }), selecting the egov adapter when
# portal.api='egov-bg'. Overlap under onOverlap='skip' still exits 5.
```

To confirm the egov-bg selection without a live portal, the offline dispatch test
from step 2 exercises the exact `buildPortalHttp` + `runPortalSync` path the
scheduler uses; the scheduler differs only in `trigger:'scheduled'` and the
persistent HTTP stack across fires.

**Acceptance check (FR-004/FR-005/FR-006)**: a `portal.api='egov-bg'` config makes
the scheduled run use the egov adapter (`POST listDatasets…`), not CKAN, and the
robots opt-out is honored so the live portal's `Disallow: /` is not re-imposed.

## Success-criteria checklist (from spec §Success Criteria)

- **SC-001**: steps 1 + 3 — every search/entity hit for a dataset with curated
  artifacts carries a `curatedDatasetPath` that resolves on disk under
  `store/curated/`.
- **SC-002**: step 2 — egov-bg dispatch issues egov endpoints + zero CKAN calls;
  ckan dispatch issues `package_search` + zero egov calls.
- **SC-003**: step 4 — `danni search` / `danni index` on the default local-onnx
  config print exactly one stub warning (model id `local-onnx:hash-stub-32`) per
  invocation; a real injected/hosted embedder stays quiet.
- **SC-004**: step 0 — the full suite stays green with the three additions
  (737 pass / 0 fail), lint + typecheck clean, parity-matrix + migrate-smoke
  gates pass.
- **SC-005**: specs 001–004 show a terminal Status and 002/003/004 have zero
  unchecked-but-implemented task boxes (verify by reading those `spec.md` /
  `tasks.md` files).
