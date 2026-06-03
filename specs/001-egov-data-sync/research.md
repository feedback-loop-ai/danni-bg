# Phase 0 Research — 001-egov-data-sync

**Date**: 2026-05-08
**Status**: Resolves all NEEDS CLARIFICATION items in plan.md so Phase 1 can proceed.

The plan listed five technical decisions deferred to research, plus two
quantification items. Each is resolved below in the canonical
**Decision / Rationale / Alternatives considered** form.

---

## R1 — data.egov.bg portal API surface

**Decision**: Treat data.egov.bg as a **CKAN-compatible portal** and target the
CKAN Action API at `https://data.egov.bg/api/3/action/`. The crawler consumes,
at minimum, the following endpoints:

| Endpoint | Purpose | Spec entry |
|----------|---------|------------|
| `package_list` | Enumerate all dataset identifiers | FR-001 |
| `package_search` (paginated, `rows`/`start`) | Filtered enumeration for scope filter (FR-018) and incremental discovery via `metadata_modified` ordering | FR-001, FR-004, FR-018 |
| `package_show?id=<id>` | Full dataset metadata + resource list | FR-002 |
| `organization_list` / `organization_show` | Authoritative publisher metadata for entity extraction (FR-019a) | FR-019a |
| `group_list` / `group_show` | Categories / subject groupings for scope filter | FR-018 |
| `tag_list` | Tag enumeration for scope filter | FR-018 |
| `<resource.url>` (off-portal HTTP GET) | Raw resource bytes; resources may be hosted on or off the portal | FR-002, FR-005 |
| `/robots.txt` | Crawler etiquette (Principle XI) | constitution |

The crawler **MUST NOT** assume the data resource URL is on the same host as the
catalog API; CKAN portals routinely link to resources hosted on agency-owned
domains. Conditional requests (`If-None-Match`, `If-Modified-Since`) are
attempted on every resource fetch but the crawler MUST NOT fail when the
upstream does not implement them — it falls back to content-hash comparison.

**Rationale**: data.egov.bg has historically been operated as a CKAN instance
and the constitution explicitly references "CKAN-style action API" as the
expected shape. Modeling against CKAN gives us an established response schema
to validate, well-understood pagination semantics (`rows` / `start` /
`result.count`), and a documented error envelope (`{success: false, error:
{__type, message}}`).

**Alternatives considered**:
- *Scrape the HTML catalog* — rejected. The constitution explicitly puts UI
  scraping out of scope when a machine-readable catalog exists.
- *Assume a non-CKAN bespoke API* — rejected. We MAY discover divergences from
  vanilla CKAN; those are recorded in `specs/portal-api/` as the API Reference
  Spec is built out, but the v1 architecture assumes CKAN and adapts on
  observed deviation. A live smoke task in Phase 2 will exercise each endpoint
  and capture a fixture that confirms or refines the assumed shape.

**Open follow-up** (Phase 2 task, not blocking): a `tasks.md` task will
exercise each endpoint above against the live portal once, record fixtures,
and write the endpoint shape into `specs/portal-api/`. Any divergence from
vanilla CKAN gets documented there before any code path depends on it.

---

## R2 — Local store: SQLite with FTS5 + sqlite-vec

**Decision**: Use **SQLite via `bun:sqlite`** as the single durable queryable
store. Schema kept in forward-only SQL migration files under `migrations/`;
applied versions tracked in a `schema_migrations` table. Full-text search uses
SQLite **FTS5** with `tokenize='unicode61 remove_diacritics 0'`. Semantic
similarity uses the **`sqlite-vec`** extension (loaded at startup) with a
virtual table holding embeddings of curated dataset titles, descriptions
(BG + EN), column labels, and extracted entity names.

Raw bytes are NOT stored in SQLite; they live on disk under
`store/raw/<dataset_id>/<resource_id>/<sha256>.<ext>` as content-addressed
blobs. SQLite holds the row per resource with `raw_path`, `sha256`, `bytes`,
`content_type`, and freshness columns. Curated artifacts also live on disk
(NDJSON for tabular, JSON for everything else) with their paths recorded in
SQLite alongside curation provenance.

**Rationale**:
- *Operational simplicity* (Principle V) — one file, no daemon, transactional,
  atomic via WAL, trivial backups (copy the file).
- *Bun-native* — `bun:sqlite` is shipped with Bun and outperforms
  `better-sqlite3` in the Bun runtime (Principle VI).
- *FTS5 with `unicode61 remove_diacritics 0`* — preserves Cyrillic letters
  exactly, supporting Bulgarian collation needs (Principle X). A diacritics-
  stripping tokenizer would conflate е/ѣ legacy forms in ways that destroy
  authoritative-field fidelity.
- *`sqlite-vec`* — an embedded vector index keeps "single durable store"
  honest (no separate vector DB to operate). Works against the same SQLite
  file, shares the transaction boundary with FTS5 and the canonical tables.
- *Migrations checked into the repo* — required by the constitution
  ("MUST support schema migrations checked into the repo").
- *Raw bytes on disk, not in SQLite* — keeps the SQLite file small and easy to
  back up/inspect, lets us page large resources without buffering, and the
  content-addressed layout means re-writing the same resource is a no-op
  (FR-004 incremental reuse).

**Alternatives considered**:
- *Postgres + pgvector* — rejected for v1. More moving parts, no single-file
  semantics, requires an additional service. Could be revisited if scale
  forces it; the SQLite design does not preclude a future port because the
  schema is plain SQL.
- *Object store (S3/MinIO) + external search index* — rejected. The
  constitution explicitly calls for *a single durable queryable store*;
  fan-out across multiple services violates Principle V at this stage.
- *Raw bytes inside SQLite as BLOBs* — rejected. SQLite does support BLOBs
  but resources can be large (per FR edge case "extremely large resource");
  streaming to disk is the right primitive.
- *DuckDB* — strong on tabular analytics but FTS over Cyrillic is not
  first-class and there is no in-tree vector extension as mature as
  `sqlite-vec`. Curators MAY use DuckDB ad-hoc for analysis, but it is not the
  durable store.

---

## R3 — Embedding model for semantic index

**Decision**: Use a **multilingual sentence-embedding model** wired through a
**pluggable provider interface** (`src/index/embedder.ts`). v1 ships **two
provider implementations** behind the same interface:

1. `local-onnx` (default for offline/dev): a small multilingual model
   (e.g. paraphrase-multilingual-MiniLM-L12-v2 class, ~120M params) loaded
   via `onnxruntime-node` and run CPU-only. Embeds in batches; ~50–150ms per
   batch on a developer laptop. No outbound network. Good enough recall for
   SC-004's top-5 target on a moderately sized corpus.
2. `hosted-api` (opt-in for production): a configurable HTTPS endpoint that
   speaks an OpenAI-compatible `/v1/embeddings` shape. The operator supplies
   a base URL + API key via config.

The provider interface is `embed(texts: string[]) => Promise<Float32Array[]>`;
the choice is a config setting. The vector dimension is recorded in the
`embeddings_meta` table; switching models invalidates and rebuilds the vector
index (the rebuild is incremental — re-embed in batches of N).

**Rationale**:
- *Pluggable* — keeps the constitution's offline-dev-loop guarantee while
  allowing operators to upgrade quality in production without code changes.
- *Multilingual-first* — Bulgarian + English query symmetry is a hard
  requirement (FR-014). English-only embedders would fail the BG-side recall
  target.
- *Local default* — Principle VI (offline dev loop) and Principle XI (no
  unnecessary outbound traffic) both favor a local default.

**Alternatives considered**:
- *Bag-of-words / TF-IDF only* — rejected. FTS5 already covers the lexical
  side; semantic similarity is an explicit FR (FR-012) and is the differentiator
  from a brute-force keyword search.
- *Hosted-only embeddings (no local default)* — rejected. Forces every
  contributor to provision an API key for the inner dev loop, breaks
  Principle VI.
- *Train a custom embedder* — rejected. YAGNI.

**Open follow-up** (Phase 2 task): benchmark the chosen local model against a
small Bulgarian/English query set during implementation; if recall is
inadequate, the interface lets us swap without touching the call sites.

---

## R4 — BG→EN translation provider for FR-019c

**Decision**: Wrap translation behind a **pluggable provider interface**
(`src/enrich/translator.ts`) with two v1 implementations:

1. `local-marianmt` (default): a Bulgarian→English MarianMT model (Helsinki-NLP
   `opus-mt-bg-en` class) run via `onnxruntime-node`. Works fully offline.
2. `hosted-api`: a configurable HTTPS endpoint (operator-supplied base URL +
   API key) speaking a small JSON contract: `{text: string, source: 'bg',
   target: 'en'} -> {text: string, confidence: number}`.

Each translation record stores `{text_bg, text_en, translator: 'local-marianmt'
| 'hosted-api:<id>', confidence: number}`. The original Bulgarian field is
**never** mutated (Principle X, FR-019c). Empty or low-confidence translations
are stored as such and never substituted for the original.

**Rationale**: Same reasoning as R3 — multilingual-first, offline-default,
operator-upgradable.

**Alternatives considered**:
- *No translation, English-only via embeddings* — rejected. FR-019c is
  explicit about producing an English title and description.
- *Translate at query time only* — rejected. Translations are a stored
  enrichment with provenance + confidence (FR-019d); generating per-query
  defeats provenance and breaks the index contract.

---

## R5 — Entity extraction strategy (FR-019a / FR-019b)

**Decision**: v1 uses a **rule-based + gazetteer-driven** extractor pipeline
with explicit confidence per extractor. No ML NER in v1 (Principle V — start
simple). Extractors and their confidence ranges:

| Extractor | Source | Output entity kind | Confidence basis |
|-----------|--------|--------------------|------------------|
| `ckan_organization` | CKAN `organization` field on dataset | publishing organization | 1.0 (authoritative) |
| `ckan_groups` | CKAN `groups` field | thematic / subject | 1.0 (authoritative) |
| `ckan_tags` | CKAN `tags` field | named subject (low specificity) | 0.6 |
| `bg_admin_gazetteer` | Curated list of Bulgarian oblasts (28) and municipalities (~265) matched against curated text fields and column values | geographic unit | 0.7–0.95 by match exactness |
| `iso8601_dates` | Date parser over column values + free text | time period | 0.95 |
| `bg_month_dates` | Bulgarian month-name parser (`януари`–`декември`) over free text | time period | 0.85 |
| `column_name_heuristics` | Pattern match on column labels (e.g. `egn`, `bulstat`, `eik`, `общин`, `област`) | named registry subject hint | 0.5–0.8 |

Cross-dataset linking (FR-019b): two datasets are linked through a shared
entity if they reference the same canonicalized entity ID. Canonicalization is
deterministic per entity kind (e.g. organization by CKAN org ID; municipality
by gazetteer ID). The link record stores `{entity_id, heuristic, confidence}`
per FR-019d.

Ambiguous matches (edge case in spec) are stored as **multiple candidate
entities** with their confidences rather than collapsed to a single guess.

**Rationale**: v1 needs to ship and be useful. Rule-based extractors over
authoritative CKAN fields plus a small Bulgarian gazetteer cover the
"pragmatic set of categories" the spec assumptions explicitly call out
(publishing organizations, geographic units, time periods, named registry
subjects). They are deterministic, testable to 100% coverage, and carry
honest confidence numbers. ML extractors can be added later behind the same
extractor interface without changing the data model.

**Alternatives considered**:
- *Spacy / transformer NER for Bulgarian* — rejected for v1. Adds a heavy
  runtime dependency, complicates testing, and the pragmatic categories the
  spec lists are dominated by structured CKAN fields and a small gazetteer.
- *External entity-linking service* — rejected. Violates the offline-default
  principle and adds operational fragility.
- *No entity extraction in v1, defer to v2* — rejected. FR-019a/b are P2
  product requirements with explicit success criteria (SC-009, SC-011). They
  ship now.

---

## R6 — Scheduler

**Decision**: An **in-process scheduler** (`src/schedule/scheduler.ts`) that
fires Sync Runs at a configurable cron-like cadence. State persisted in
SQLite (`scheduler_state` table). Concurrency control via a single-row
**advisory lock table** (`sync_runs_lock` with a single `is_locked` row) wrapped
in a SQLite transaction; FR-017c's "skip or queue" behavior is a config option
(`schedule.on_overlap: 'skip' | 'queue'`).

The CLI also exposes a **manual trigger** (`bun run sync now`) that respects
the same lock. The scheduler is not a daemon process by default — operators
can run it as a foreground process under systemd/launchd/Docker, or skip it
entirely and drive runs from cron.

**Rationale**: Principle V — the simplest mechanism that satisfies FR-017,
FR-017a, FR-017c. SQLite-backed lock keeps the constraint honest even across
process restarts.

**Alternatives considered**:
- *External cron only, no in-process scheduler* — viable but loses the
  single-process self-contained ergonomic. We keep cron as a supported mode
  but do not require it.
- *A real job queue (BullMQ etc.)* — rejected. Brings Redis. Massive overkill.

---

## R7 — Conditional-request strategy

**Decision**: For every resource fetch:

1. If the local store has a prior `etag`, send `If-None-Match: <etag>`. On
   `304 Not Modified`, mark the resource skipped-unchanged and update
   `last_synced_at`.
2. Else if the local store has a prior `last_modified`, send
   `If-Modified-Since: <last_modified>`. Same handling on `304`.
3. Else fetch unconditionally, but **always** stream the response to a
   temporary file, hash on the fly, and only commit the new path if the SHA-256
   differs from the prior `sha256`. If the hash matches, the existing blob is
   reused and only `last_synced_at` is updated (FR-004).

ETags / Last-Modified values are persisted on every successful fetch (whether
the response was 200 or 304-with-new-meta). The crawler tolerates upstream
servers that return invalid or weak ETags by treating them as opaque strings.

**Rationale**: Achieves FR-004's "incremental re-sync" semantics regardless of
upstream support: if the upstream supports ETags we save bandwidth on the
network; if it doesn't, the content-hash comparison still avoids re-writing
identical bytes (and so satisfies SC-002's < 10% re-sync budget for an
unchanged portal).

**Alternatives considered**:
- *Trust the upstream `Last-Modified` only* — rejected. CKAN portals are
  inconsistent about it; content-hash is the durable source of truth.
- *Always re-download, deduplicate by hash post-hoc* — rejected. Wastes
  bandwidth and is rude to the portal (Principle XI).

---

## R8 — Quantification: portal scale

**Decision**: The plan does NOT bake in a fixed dataset count. The crawler is
designed to handle 10² – 10⁵ datasets without architectural change (SQLite +
FTS5 + flat blob store comfortably handle this range on a single machine).
Concrete numbers will be captured as a side-effect of the first live smoke run
(Phase 2 task) and recorded in `specs/portal-api/scale.md`.

**Rationale**: Per the spec assumptions, storage planning is the operator's
responsibility. The architecture's scale envelope is what we commit to here;
the exact current portal size is observed, not assumed.

**Alternatives considered**:
- *Block the plan on counting datasets first* — rejected. The architecture is
  insensitive to the exact count within the stated envelope; deferring the
  count is honest and unblocks Phase 1.

---

## R9 — Operator notification channel (FR-017b)

**Decision**: Notification delivery is abstracted behind a **pluggable
notifier** (`src/notify/notifier.ts`) with two v1 implementations:

1. `stderr` (default): writes a structured JSON record to stderr; suitable
   for systemd/journald/Docker log capture.
2. `webhook`: POSTs the same JSON record to an operator-supplied URL with
   optional bearer auth.

The operator configures the notifier and the failure-rate threshold in the
config file. Per the spec, the operator decides the threshold; the system
enforces it.

**Rationale**: Keeps the v1 dependency footprint at zero (stderr is universal)
while leaving a clean upgrade path to Slack/email/PagerDuty without changing
call sites.

**Alternatives considered**:
- *Bake in Slack/email* — rejected. Brings dependencies and credentials we
  don't need to ship in v1.

---

## Summary: NEEDS CLARIFICATION items resolved

| Item | Resolution |
|------|-----------|
| Portal API surface | R1: CKAN Action API at `https://data.egov.bg/api/3/action/`, fixtures captured per endpoint |
| Local store choice | R2: SQLite via `bun:sqlite` + FTS5 + `sqlite-vec`; raw bytes on disk |
| Embedding model | R3: pluggable; default local multilingual ONNX, optional hosted API |
| Translation provider | R4: pluggable; default local MarianMT BG→EN, optional hosted API |
| Entity extraction | R5: rule-based + Bulgarian gazetteer with explicit per-extractor confidence |
| Scheduler | R6: in-process scheduler with SQLite advisory lock; cron also supported |
| Conditional fetches | R7: ETag → If-Modified-Since → content-hash comparison fallback |
| Portal scale | R8: not baked in; observed during first live smoke and recorded in `specs/portal-api/scale.md` |
| Notifier | R9: pluggable; default stderr, optional webhook |

All Phase 0 NEEDS CLARIFICATION items are resolved. Phase 1 may proceed.
