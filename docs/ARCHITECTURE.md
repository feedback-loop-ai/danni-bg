# danni-bg — Architecture

`danni-bg` keeps a **local, byte-faithful mirror of [data.egov.bg](https://data.egov.bg)** and turns it into a curated, enriched, machine-readable corpus that can be searched offline.

It is a single Bun + TypeScript CLI (`danni`) over a SQLite store. Everything flows through one pipeline:

```
sync  →  curate  →  enrich  →  index  →  search
```

Each stage is independent, idempotent, and re-runnable; the store on disk is the source of truth.

---

## 1. The pipeline at a glance

```mermaid
flowchart TD
  CFG["danni.config.json<br/>portal.api · scope · rate/robots · embedder · translator"]
  PORTAL[("data.egov.bg<br/>live portal")]

  subgraph CLIENTS["Portal clients"]
    CKAN["CkanClient<br/>GET /api/3/action"]
    EGOV["EgovBgClient<br/>POST /api/{method}"]
  end
  HTTP["PortalHttp<br/>RateLimiter · BackoffRunner · RobotsCache (obey / allowHosts)"]

  PORTAL --> CKAN --> HTTP
  PORTAL --> EGOV --> HTTP
  CFG -.-> CLIENTS

  HTTP --> SYNC["1 · SYNC<br/>danni sync"]
  SYNC --> CURATE["2 · CURATE<br/>danni curate"]
  CURATE --> ENRICH["3 · ENRICH<br/>entities · links · translations"]
  ENRICH --> INDEX["4 · INDEX<br/>danni index"]
  INDEX --> SEARCH["5 · SEARCH<br/>danni search · mirror-info · status"]

  SYNC --> RAW[("store/raw/*<br/>byte-faithful")]
  CURATE --> CUR[("store/curated/*<br/>data.ndjson / json + schema.json")]
  SYNC --- DB[("store/danni.sqlite")]
  CURATE --- DB
  ENRICH --- DB
  INDEX --- DB
  SEARCH --- DB
```

Plain-text view of the same flow:

```
                          danni.config.json
        portal.api (ckan│egov-bg) · scope · rate/robots · embedder · translator
                                   │
   ┌───────────────────────────────────────────────────────────────────────┐
   │                       data.egov.bg  (live portal)                       │
   └─────────────┬───────────────────────────────────┬─────────────────────┘
   CkanClient (GET /api/3/action)        EgovBgClient (POST /api/<method>)   │
   package_search / package_show          listDatasets / getDatasetDetails  │
                 └──────────────┬──────────listResources / getResourceData──┘
                                ▼
        PortalHttp  ─ RateLimiter · BackoffRunner · RobotsCache(obey / allowHosts opt-out)
                                │
   ╔════════════╗   ╔══════════▼═══════════╗   ╔═══════════╗   ╔═══════════╗   ╔══════════╗
   ║  1. SYNC   ║──▶║  2. CURATE           ║──▶║ 3. ENRICH ║──▶║ 4. INDEX  ║──▶║ 5.SEARCH ║
   ║ danni sync ║   ║   danni curate       ║   ║ (part of  ║   ║danni index║   ║danni     ║
   ╚═════╤══════╝   ╚══════════╤═══════════╝   ║  curate)  ║   ╚═════╤═════╝   ║ search   ║
         │                     │               ╚═════╤═════╝         │         ╚════╤═════╝
         ▼                     ▼                     ▼               ▼              ▼
   store/raw/*           store/curated/*        entities/links   datasets_fts   hybrid
   (byte-faithful)       data.ndjson|json       translations     dataset_       FTS5 + vector
                         + schema.json                           embeddings     (RRF fusion)
         └─────────────────────────┴─────── store/danni.sqlite ──────┴──────────────┘
```

---

## 2. Stages

### 1 · Sync — `danni sync` (`src/crawler`, `src/cli/sync.ts`)

Pulls the portal into `store/raw/` and records metadata in SQLite. Two interchangeable portal clients, selected by `portal.api`:

| `portal.api` | Client | Orchestrator | Notes |
|---|---|---|---|
| `ckan` (default) | `CkanClient` (GET `/api/3/action/*`) | `run-sync.ts` | Standard CKAN; documented contract + recorded fixtures |
| `egov-bg` | `EgovBgClient` (POST `/api/<method>`) | `run-egov-sync.ts` | data.egov.bg's **actual** API (governmentbg/data-gov-bg) |

All HTTP goes through `PortalHttp` (`http.ts`) with `RateLimiter`, `BackoffRunner`, and `RobotsCache`. Respectful by default; `crawler.robots.obey: false` / `allowHosts` is an operator opt-out for the official public API.

- **CKAN path**: `discover` (package_search) → `packageShow` → `capture-resource` downloads each resource's bytes (conditional GET via etag/last-modified).
- **egov-bg path**: `listDatasets` → `getDatasetDetails` → `listResources` → `getResourceData` (the portal's datastore returns rows; array-of-arrays → CSV, else JSON), captured into `store/raw/`.
- **Resumable full crawl** (`crawl-checkpoint.ts`, `scope-hash.ts`, `egov-validator.ts`): a `crawl_checkpoint` keyed by scope-hash with a **frozen sorted dataset-id cursor** and per-resource completion + attempt counts; **atomic capture** (temp + fsync + rename); runs inside `beginSyncRun` (shared `sync_runs_lock`, mutually exclusive with the CKAN path); `--max` per-session batch and `--retry-failed` (max-attempts cap).

**Writes:** `store/raw/<dataset>/<resource>/raw.*` + `datasets`, `resources`, `organizations`, `sync_runs` rows.

### 2 · Curate — `danni curate` (`src/curate`)

Normalizes raw bytes into typed, UTF-8 artifacts with a declared schema.

```
CuratorRegistry.select(resource)  ── sniff(magic bytes + extension + declared format)
        │
        ├─ CsvCurator   ├─ XlsxCurator   ├─ GeoJsonCurator   ├─ JsonCurator
        ├─ XmlCurator   ├─ TextCurator   └─ UncuratedMarker (fallback, raw retained)
        │                  └ dependency-free OOXML reader (ZIP central dir + node:zlib inflate)
        ▼
  encoding.ts  (BOM → CP1251 vs UTF-8 heuristic)
  normalize.ts (ISO/Bulgarian-month dates, decimal-comma numbers)
  schema.ts    (per-column type inference; canonicalizeName w/ Cyrillic→Latin transliteration)
```

`CsvCurator.canHandle` rejects ZIP-magic bytes so a mislabeled `.xlsx` routes to `XlsxCurator`. Column names are transliterated (`"Пореден №"` → `poreden_no`) while the original Cyrillic is preserved in `sourceName`/`labelBg`.

**Writes:** `store/curated/<dataset>/<resource>/data.ndjson|data.json|data.xml|data.txt` + `schema.json`, and a `curated_artifacts` row. Re-curation is idempotent per `curator_version`.

### 3 · Enrich — runs inside the curate orchestrator (`src/enrich`)

Attaches machine-meaning to each dataset.

```
Extractors (src/enrich/extractors)         registerEntities → entities + dataset_entities
  ckan_organization · ckan_groups · ckan_tags
  bg_admin_gazetteer (28 oblasts + municipalities)   linkDatasets → dataset_links
  iso8601_dates · bg_month_dates · column_name_heuristics   (shared entity, undirected)

Translators (src/enrich/translators)       translate → translations
  local-marianmt (stub) │ hosted-api        BG preserved byte-exact; EN added with provenance/confidence
```

### 4 · Index — `danni index` (`src/index`)

Builds the two search indexes over active, curated datasets.

```
per dataset:
  buildFtsRow (fts.ts)            → datasets_fts          (FTS5 keyword)
  composeEmbeddingText (vec.ts)   → Embedder.embed()      → dataset_embeddings (BLOB vector)
                                     local-onnx (hash stub) │ hosted-api (real model)
```

Two recent additions make a corpus-scale re-index practical:

- **Incremental** (`index-state.ts`): a per-dataset `index_state(content_fp, embed_fp, model_id)` fingerprint ledger. A dataset is skipped only when its fingerprint matches **and** the target store row exists; a model change re-embeds **vectors only** (FTS is model-independent); `--full` forces a single-transaction rebuild; every run reconciles against `listActive()` and purges orphans from all three stores. Incremental is the default (`config.index.incremental`; precedence `--full` > config > true).
- **Batched** (`batch-embed.ts`): embeds **only the changed set** in batches (default 32) with positional length-checked mapping, single-text retry, and 429/5xx backoff; an `index_failures` ledger records per-dataset not-embedded reasons. FTS stays per-dataset, outside batching.

### 5 · Search & read (`src/index/query.ts`, `src/cli/{search,mirror-info,status}.ts`)

```
danni search "Плевен"   FTS5 keyword  ⊕  vector cosine  →  RRF fusion  →  ranked IndexEntry[]
searchByEntity(...)     entity-anchored recall via dataset_entities
danni mirror-info <id>  joins datasets+resources+curated_artifacts+entities+links+translations
danni status            sync-run history + freshness SLO
```

Every result carries a pointer back to the curated artifact and the original source URL (one-hop traceability).

---

## 3. Storage & schema

```
store/
 ├─ raw/      <dataset_id>/<resource_id>/raw.*        ← byte-faithful archive (a static mirror)
 ├─ curated/  <dataset_id>/<resource_id>/data.* + schema.json
 └─ danni.sqlite
```

Migrations are applied in numeric order by a checksum-guarded runner (`src/store/migrate.ts`):

| Migration | Adds | For |
|---|---|---|
| `001_core` | `datasets`, `resources`, `organizations`, `sync_runs` (+ lock + events) | sync |
| `002_curate_enrich` | `curated_artifacts`, `entities`, `dataset_entities`, `dataset_links`, `translations`, `embeddings_meta` | curate + enrich |
| `003_index` | `datasets_fts` (FTS5), `dataset_embeddings` (BLOB) | index |
| `004_index_failures` | `index_failures` | batch embedding |
| `005_index_state` | `index_state` (incremental fingerprints) | incremental indexing |
| `006_crawl_checkpoint` | `crawl_checkpoint` | resumable crawl |

Vectors are stored as plain BLOBs; similarity search is in-process cosine + Reciprocal-Rank-Fusion with FTS5 (the `sqlite-vec` virtual-table path is a future upgrade for large corpora).

---

## 4. Configuration (`danni.config.json`)

```jsonc
{
  "portal":  { "baseUrl": "...", "api": "ckan" | "egov-bg", "apiKeyEnv": null },
  "crawler": { "userAgent": "...", "rateLimit": {...}, "concurrency": {...},
               "backoff": {...}, "robots": { "recheckIntervalSeconds": 86400,
                                             "obey": true, "allowHosts": [] } },
  "store":   { "root": "./store", "freshnessSloSeconds": 86400 },
  "schedule":{ "enabled": false, "cron": null, "onOverlap": "skip", "notifier": {...} },
  "scope":   { "publishers": [], "categories": [], "tags": [], "datasetIds": [] },
  "enrichment": { "translator": { "provider": "local-marianmt" | "hosted-api", ... },
                  "embedder":   { "provider": "local-onnx"     | "hosted-api", ... } },
  "index":   { "incremental": true }
}
```

`scope` (empty = the whole portal) selects which datasets to mirror. `schedule` drives recurring runs with overlap prevention via the `sync_runs_lock`.

---

## 5. Source map (`src/`)

| Subsystem | Responsibility |
|---|---|
| `cli/` | the `danni` command surface (`sync`, `curate`, `index`, `search`, `mirror-info`, `status`, `schedule`) |
| `config/` | zod-validated config schema + loader |
| `crawler/` | portal clients (ckan/egov), `PortalHttp`, rate-limit/backoff/robots, discovery, capture, checkpoint/resume |
| `curate/` | curator registry + per-format curators, sniff/encoding/normalize/schema, curate orchestrator |
| `enrich/` | entity extractors, gazetteer, entity registrar, cross-dataset linker, translators |
| `index/` | FTS + vector builders, embedders, incremental `index_state`, `batch-embed`, query/search |
| `manifest/` | `beginSyncRun`, run records, lock, manifest writer |
| `store/` | `bun:sqlite` open/migrate + typed repos per table |
| `lib/`, `logging/`, `notify/`, `schedule/` | hashing/ids/time/fs, structured logging, notifier, cron |

---

## 6. Caveats worth knowing

- **The semantic half is stubbed.** `local-onnx` (embedder) and `local-marianmt` (translator) ship as **deterministic placeholders** — the FTS/keyword half of search is real; real *semantic* vectors and EN translations need a real model/API wired via config (the index/search plumbing already supports it, and `batch-embed` makes a real-model re-index practical at corpus scale).
- **The live data.egov.bg crawl needs the egov adapter + a robots opt-out.** The portal does **not** serve the CKAN API at `/api/3/action/` (every method returns "Непознат метод"); use `portal.api: "egov-bg"` with `baseUrl: "https://data.egov.bg/api/"`. The site's `robots.txt` is `Disallow: /`, so an authorized crawl of its public API requires `crawler.robots.obey: false` (or `allowHosts: ["data.egov.bg"]`). The egov datastore serves resources as JSON rows, captured as CSV → curated as tabular.
- **The store is the source of truth.** Any stage can be re-run; the raw archive remains usable read-only even if the portal is unreachable.

---

*See `specs/001-egov-data-sync/` for the foundational spec/plan, and `specs/002-004-*/` for the incremental-index, batch-embedding, and crawl-resume features (each with its clarified spec, plan, and task list).*
