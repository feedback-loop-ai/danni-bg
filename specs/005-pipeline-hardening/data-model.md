# Data Model — 005-pipeline-hardening

**Date**: 2026-06-04
**Status**: Implemented
**Scope**: **No database schema change and no new migration.** This feature corrected
values emitted into an existing read contract (`IndexEntry`), added one new *internal*
dispatch module (`src/crawler/portal-sync.ts`), and exposed one boolean on an existing
class (`LocalOnnxEmbedder.isStub`). The index-entry contract is unchanged — its schema
(`additionalProperties: false`) already described `curatedDatasetPath` as a "relative
path under store/curated/"; the fix made the *emitted value* honor that description (R6).
There is therefore **no `contracts/` directory** for this feature, exactly as for 002
and 003.

> **Naming convention** (inherited from 001): `snake_case` SQL identifiers;
> `kebab-case` file paths; `camelCase` TypeScript fields. Timestamps are ISO-8601
> UTC `TEXT` via `nowIso()` (`src/lib/time.ts`).

---

## 1. No schema change / no migration

The last applied migration remains `005_index_state.sql` (from feature 003). This
feature added **no** `migrations/*.sql` file. Confirmation that nothing in the data
layer changed:

- No new table, column, or index. The skip ledger (`index_state`, 003), the curated
  artifacts table (`curated_artifacts`, 002), the entities table (`entities`, 001), and
  the embedding stores are all read as-is.
- `search()` / `searchByEntity()` now **join** existing tables they did not previously
  consult (`curated_artifacts` via `CuratedArtifactsRepo.byDataset`, and `entities` via
  `EntitiesRepo.get`) to ground the values they emit — but read only, no writes, no DDL.
- The published index-entry contract file (`specs/001-egov-data-sync/contracts/index-entry.schema.json`,
  owned by 001) is byte-for-byte unchanged. The change is entirely in the value produced
  by `src/index/query.ts`.

---

## 2. Touched read contract — `IndexEntry`

`IndexEntry` (`src/index/query.ts`, schema `index-entry.schema.json`) is the published,
one-result-per-hit read contract returned by `search()` and `searchByEntity()`. No field
was added or removed (the schema is closed). Two of its existing fields had their
*semantics tightened and their emitted value corrected*.

### 2.1 `curatedDatasetPath` — semantics clarified, value grounded (FR-001)

| Aspect | Settled behavior |
|---|---|
| Type | `string` (unchanged) |
| Meaning | Relative path under `store/curated/` to the dataset's **curated directory** — the dataset-level record. Curated artifacts live on disk at `<datasetId>/<resourceId>/data.*`, so the dataset-level record *is* that directory; a consumer enumerates the per-resource artifacts within it (`danni mirror-info`). (R1) |
| Derivation | `resolveCuratedDatasetPath(artifacts, datasetId)` takes the dataset's real `curated_artifacts` rows (`CuratedArtifactsRepo.byDataset(datasetId)`), picks the first artifact with a non-empty `path`, and returns that path's **top-level segment**. When the dataset has no curated artifacts yet it falls back to the dataset id (the canonical curated directory). |
| Invariant | MUST be relative — never starts with `/`. By the on-disk layout the directory's relative path equals the dataset id; the old code emitted that id incidentally, the new code derives it from real artifact rows so the pointer is grounded/validated. |
| Both code paths | `search()` and `searchByEntity()` use the same `resolveCuratedDatasetPath` helper, so the two surfaces cannot diverge. |

The helper signature (`src/index/query.ts`):

```ts
function resolveCuratedDatasetPath(artifacts: CuratedArtifactRow[], datasetId: string): string
```

### 2.2 `matchedEntities[]` — real kind + bilingual label (FR-002)

`searchByEntity()` previously hardcoded each matched entity to `kind: 'unknown'` with an
empty `label`. It now reads the real entity row once (`EntitiesRepo.get(entityId)`) and
populates the array element from it:

| Field | Source (`EntityRow`) |
|---|---|
| `entityId` | the queried entity id |
| `kind` | `entities.kind` (the real `EntityKind`) — never `'unknown'` for a present entity |
| `label.bg` | `entities.canonical_label_bg` |
| `label.en` | `entities.canonical_label_en` (`string \| null`) |

The schema's `matchedEntities[]` item is unchanged (`required: ['entityId', 'kind']`,
optional `label`); only the emitted value moved from a degraded placeholder to the real row.

### 2.3 Contract test tightening (FR-003)

`tests/contract/index-entry.test.ts` was strengthened beyond a bare `z.string()` on
`curatedDatasetPath`: it now asserts the path is relative (does not start with `/`),
equals the expected canonical directory (`'d1'` for the no-artifact fallback), and that
`sourceUrl` round-trips. The e2e test (§5) additionally asserts the path **resolves to an
on-disk directory** under `store/curated/`.

---

## 3. New internal dispatch contract — `PortalSync`

`src/crawler/portal-sync.ts` is a **new internal module** (not a published contract, not
added to any `contracts/` directory). It centralizes portal-client + sync-runner
selection so the interactive `sync` CLI and the scheduler cannot drift (R3). Two exported
surfaces:

### 3.1 `buildPortalHttp(config, fetcher?)` (FR-005)

```ts
function buildPortalHttp(config: DanniConfig, fetcher?: typeof fetch): PortalHttp
```

Builds the shared HTTP stack — `RateLimiter` + `BackoffRunner` + `RobotsCache` wrapped in
`PortalHttp`. Crucially it wires `config.crawler.robots.obey` and
`config.crawler.robots.allowHosts` into the `RobotsCache`, applying the operator's robots
opt-out. The live data.egov.bg API serves `robots.txt: Disallow: /`, so an authorized
crawl needs this opt-out; the scheduler previously omitted it and would re-impose
`Disallow: /` (capturing nothing). The optional `fetcher` is an injectable `typeof fetch`
for offline testability (R4).

### 3.2 `runPortalSync(opts)` + `{api, result}` discriminated union (FR-004, FR-006)

Options:

```ts
interface RunPortalSyncOptions {
  db: Database;
  config: DanniConfig;
  http: PortalHttp;
  storeRoot: string;
  trigger: RunTrigger;
  notifier?: Notifier | undefined;
  scope?: ScopeConfig | undefined;
  max?: number | undefined;
  retryFailed?: boolean | undefined;
  dryRun?: boolean | undefined;
  manifestOut?: string | undefined;
}
```

Return — a discriminated union keyed on `config.portal.api`:

```ts
type RunPortalSyncResult =
  | { api: 'ckan'; result: RunSyncResult }
  | { api: 'egov-bg'; result: RunEgovSyncRunResult };
```

| `config.portal.api` | Client | Runner | Returned tag |
|---|---|---|---|
| `'egov-bg'` | `EgovBgClient` (POST `listDatasets…`; reads `apiKeyEnv` from `process.env`) | `runEgovSyncRun` (resumable campaign runner) | `{ api: 'egov-bg', result }` |
| `'ckan'` | `CkanClient` (`/api/3/action/package_search`) | `runSync` (standard CKAN runner) | `{ api: 'ckan', result }` |

The CKAN `/api/3/action/` endpoint returns `"Непознат метод"` against the live portal, so
the `egov-bg` branch is the only one that can crawl data.egov.bg. The dispatch preserves
each path's existing exit-code semantics at the CLI boundary (egov: failed → 3 else 0,
stdout JSON; ckan: success → 0 else 3; scheduler overlap-skip → 5). The discriminated tag
lets each caller reattach its path-specific handling without re-branching on the config.

**Consumers**: `src/cli/sync.ts` (interactive, `trigger:'manual'`) and `src/cli/schedule.ts`
(`trigger:'scheduled'`) both build HTTP via `buildPortalHttp` and run via `runPortalSync`,
so they are in lockstep by construction.

---

## 4. `LocalOnnxEmbedder.isStub` (FR-007)

A new read-only boolean on the existing embedder
(`src/index/embedders/local-onnx.ts`):

| Field | Type | Meaning |
|---|---|---|
| `isStub` | `boolean` | `true` when the constructor received no injected `embedFn`, i.e. it fell back to the deterministic `hashEmbedding` hash stub. Set as `this.isStub = opts.embedFn === undefined`. |

The warning lives at the **CLI boundary**, not in the constructor (R2): the ctor is used
legitimately by many tests with the stub, so warning there would spam/mislead. Instead,
`buildEmbedder()` in both `src/cli/search.ts` and `src/cli/index-cmd.ts` checks
`embedder.isStub` and, when true, writes a single warning to **stderr** naming the stub
model id (`embedder.id`, i.e. `local-onnx:hash-stub-32`). An injected real `embedFn` (or
the `hosted-api` provider) leaves `isStub` false, so the warning stays quiet for
tests/real models. The model id is surfaced via stderr rather than a new result field
because the index-entry schema is closed (`additionalProperties: false`).

---

## 5. End-to-end traceability assertions (FR-008)

`tests/integration/pipeline-e2e.test.ts` is the single test that drives all five stages —
`runSync` (CKAN fixtures + real CSV bytes) → `runCurate` (with an injected deterministic
`Translator` stand-in, `id: 'test:prefix'`, conf 0.9) → `runIndex` → `search` /
`searchByEntity` — against one on-disk store, so cross-stage contract drift fails here
even though every per-stage suite passes in isolation. It asserts the data-model
contracts above hold together:

- `hit.sourceUrl` contains `data.egov.bg` (one-hop traceability back to the portal).
- `existsSync(join(storeRoot, 'curated', hit.curatedDatasetPath))` is `true` — the §2.1
  path resolves to an on-disk curated directory.
- `hit.title.en === 'EN:Първи набор от данни'` — the injected translation flowed
  sync→curate→index→search.
- The first `matchedEntities[0]` from `searchByEntity` has `kind !== 'unknown'` and a
  non-empty `label.bg` — the §2.2 grounding.

---

## 6. Validation rules

Consistent with data-model 001 §5 (Zod/contract at every boundary):

1. **No new persisted-record load and no new config**: every table read by this feature
   already had its load contract defined by 001/002/003. The `index_state`/`curated_artifacts`/
   `entities` reads are point lookups (and one `byDataset` scan) over existing typed row
   interfaces.
2. **Published contract unchanged**: `index-entry.schema.json` (owned by 001) is the sole
   read-consumer contract touched, and only its *emitted values* changed; the schema and its
   `additionalProperties:false` closure are untouched. The contract test (§2.3) is the
   enforcement point.
3. **No new published contract for the internals**: `portal-sync.ts` (dispatch) and
   `LocalOnnxEmbedder.isStub` are internal module/class surfaces, not published read
   contracts, so they are not added to `specs/.../contracts/` — matching 002 and 003.

---

## 7. Relationship to existing tables and contracts

```
datasets            keyed by id            (sourceUrl → IndexEntry.sourceUrl; one-hop traceability)
curated_artifacts   keyed by dataset_id    (byDataset → resolveCuratedDatasetPath → IndexEntry.curatedDatasetPath)
entities            keyed by id            (get(entityId) → IndexEntry.matchedEntities[].kind/label)
config.portal.api                          (selects CkanClient+runSync vs EgovBgClient+runEgovSyncRun in runPortalSync)
config.crawler.robots {obey, allowHosts}   (wired by buildPortalHttp into RobotsCache)
LocalOnnxEmbedder.isStub                    (read at the CLI buildEmbedder boundary to emit the stderr stub warning)
```

`IndexEntry` is the join point where curated output, the source portal, and attached
entities are made traceable in one result object; `portal-sync.ts` is the single authority
both crawl entry points consult to choose a portal API. Neither introduces persistent state.
