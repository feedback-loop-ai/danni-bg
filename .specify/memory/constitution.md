<!--
================================================================================
SYNC IMPACT REPORT
================================================================================
Version change: (template placeholder) → 1.0.0 (initial ratified constitution)

Modified principles: N/A (initial version)

Added principles (all new at 1.0.0):
- I. AI-Native Development (NON-NEGOTIABLE)
- II. Spec-Driven Development (SDD)
- III. Contract-First API Design
- IV. Operational Excellence
- V. Simplicity & YAGNI
- VI. Fast Feedback Loops (NON-NEGOTIABLE)
- VII. Type Safety & Validation (NON-NEGOTIABLE)
- VIII. 100% Test Coverage & Endpoint Parity (NON-NEGOTIABLE)
- IX. Data Freshness & Sync Integrity (NON-NEGOTIABLE)
- X. Bulgarian-Locale Awareness
- XI. Respectful Crawling (NON-NEGOTIABLE)

Added sections:
- Technology Stack (locked: Bun + TypeScript + MCP SDK + Zod + Vitest + Biome,
  plus single durable queryable local store with migrations — concrete choice
  deferred to plan-time)
- Development Workflow (feature lifecycle, quality gates, branching)
- Governance (amendment process, compliance, semantic versioning)

Removed sections: None (initial version)

Templates requiring updates:
- .specify/templates/plan-template.md ✅ (compatible — generic Constitution Check
  gate slot, no stack-specific content)
- .specify/templates/spec-template.md ✅ (compatible — no stack-specific content)
- .specify/templates/tasks-template.md ✅ (compatible — no stack-specific content)
- .specify/templates/checklist-template.md ✅ (compatible — generic)
- CLAUDE.md ✅ (compatible — defers to current plan; no constitution-specific
  references that would drift)

Follow-up TODOs: None
================================================================================
-->

# danni-bg Constitution

> **danni-bg** — from Bulgarian *данни* ("data"). A synced local mirror of
> [data.egov.bg](https://data.egov.bg/) (Bulgaria's open data portal) exposed to
> AI agents through an MCP server.

## Core Principles

### I. AI-Native Development (NON-NEGOTIABLE)

The MCP server MUST be designed for AI-first interaction with clear,
machine-parseable interfaces over the synced local data.egov.bg corpus.

- All MCP tools MUST have unambiguous, schema-validated inputs and outputs
- Tool descriptions MUST be explicit, action-oriented, and include usage examples
- Error responses MUST be structured and actionable (no generic error messages)
- The server MUST operate as a **synced local store + MCP read interface**: it
  owns a local mirror of the portal corpus and exposes it through deterministic
  read operations. It MUST NOT invent, summarize, or otherwise alter
  authoritative portal data on the read path
- Documentation MUST be structured for AI consumption (typed interfaces, JSON
  schemas, explicit contracts)

**Rationale**: The primary consumers are AI agents querying Bulgarian open data.
Every design decision prioritizes machine comprehension, autonomous operation,
and faithful representation of the upstream portal.

### II. Spec-Driven Development (SDD)

All features MUST follow a three-role workflow with clear separation of concerns:

- **WHAT** (Product): Define user value, acceptance criteria, and priority.
  Captured in `spec.md`.
- **HOW** (Engineering): Design architecture, data models, and implementation
  approach. Captured in `plan.md`, `data-model.md`, `contracts/`.
- **VALIDATION** (QA): Verify correctness via automated tests, manual validation,
  or both. Captured in test suites and `tasks.md` checkpoints.

One person MAY wear multiple hats, but the roles MUST remain distinct in
artifacts. Every feature MUST have a spec before implementation begins.

**Rationale**: Clear role separation ensures traceability, reduces rework, and
enables parallel work by different agents or humans.

### III. Contract-First API Design

All MCP tools and all crawler interactions MUST be designed contract-first
before implementation:

- MCP tool schemas MUST be defined in `contracts/` before any code is written
- Input/output types MUST use Zod schemas with strict validation
- Breaking changes to tool signatures MUST be versioned and documented
- MCP tools MUST map cleanly to portal concepts (datasets, resources, organisations,
  groups, tags, formats) — no invented abstractions
- Error codes and messages MUST be consistent across all tools
- A **data.egov.bg API Reference Spec** MUST be maintained in
  `specs/portal-api/` documenting the full shape of every portal endpoint the
  crawler depends on:
  - Every endpoint (CKAN-style action API, REST endpoints, dataset/resource
    listing and detail endpoints, search, organisations, groups, tags) MUST
    have its request/response shapes, error codes, pagination patterns, and
    authentication flows (if any) documented
  - The reference spec MUST be detailed enough to generate contract tests
    automatically
- A **Dataset Schema Catalog** MUST be maintained in `specs/dataset-schemas/`,
  documenting the per-resource schema (columns, types, encoding, source format)
  for every dataset the system has crawled and exposes. The catalog grows as
  new datasets are encountered and MUST be the authoritative reference for any
  typed access exposed via MCP tools
- Every MCP tool MUST trace back to either a specific portal endpoint
  (documented in the API Reference Spec) or to entries in the Dataset Schema
  Catalog
- Any new portal endpoint or dataset family added to the system MUST first be
  documented in the relevant spec before implementation

**Rationale**: MCP clients depend on stable, predictable tool contracts. A
comprehensive portal API reference plus a per-dataset schema catalog ensures
every tool is backed by a verified, testable contract — eliminating guesswork
and enabling 100% validation coverage even as the upstream portal evolves.

### IV. Operational Excellence

The server MUST be designed for production reliability and observability:

- **Structured Logging**: All operations (MCP requests, crawl jobs, sync events)
  MUST log structured JSON with request/job tracing
- **Error Handling**: Every portal error and every local-store error MUST be
  mapped to a clear, actionable MCP error
- **Health Checks**: The server MUST expose health status including last
  successful sync time and per-component status
- **Graceful Degradation**: Portal unreachability MUST NOT crash the server;
  the MCP read path MUST continue to serve the last successfully synced corpus
  and clearly flag staleness (see Principle IX)
- **Security**: No sensitive data in logs; any API keys or contact emails used
  for crawling MUST be configured securely

**Rationale**: MCP servers run as infrastructure. Reliability and observability
are non-negotiable for production use, especially when an upstream public
portal can have variable availability.

### V. Simplicity & YAGNI

Start with the simplest solution that could work:

- No premature optimization or over-engineering
- Every architectural decision MUST cite a concrete requirement
- Complexity MUST be justified in writing before implementation
- Delete unused code; dead code is negative value
- Prefer direct portal-concept mapping over invented abstractions
- No feature creep: if it's not in the spec, don't build it

**Rationale**: Simplicity accelerates development and reduces maintenance
burden. The server is a thin sync + read layer over a public portal — keep it
thin.

### VI. Fast Feedback Loops (NON-NEGOTIABLE)

Development tooling MUST minimize time between code change and validation:

- **Instant Startup**: Runtime and tooling MUST start in milliseconds, not seconds
- **Hot Reload**: Development server MUST support instant code reloading
- **Fast Tests**: Unit test suite MUST complete in under 5 seconds
- **Unified Tooling**: Prefer all-in-one tools (bundler, test runner, package
  manager) over fragmented toolchains
- **Zero Config**: Tools MUST work out-of-the-box with sensible defaults
- **Local Sync Fixtures**: Crawler/sync code MUST be exercisable in tests
  against recorded portal fixtures so contributors do not need live network
  access for the inner dev loop

**Rationale**: AI-driven development generates rapid iterations. Every second
of feedback delay compounds into minutes of wasted time. Modern tooling (the
Bun ecosystem) provides 10–100x speedups over legacy Node.js toolchains.

### VII. Type Safety & Validation (NON-NEGOTIABLE)

All code MUST be type-safe with runtime validation at boundaries:

- TypeScript strict mode MUST be enabled (no `any` types except in type guards)
- All MCP tool inputs MUST be validated with Zod schemas before processing
- All portal API responses MUST be validated against the API Reference Spec
  schemas before being persisted
- All persisted records MUST be validated when loaded if the local-store layer
  cannot guarantee structural invariants (e.g., JSON columns)
- Configuration MUST be validated at startup — fail fast on misconfiguration
- Tests MUST cover validation edge cases (malformed inputs, unexpected portal
  responses, schema drift)

**Rationale**: Type safety prevents entire categories of runtime errors.
Validation at every boundary — MCP, portal, store — catches schema drift and
malformed data before it propagates to AI agents.

### VIII. 100% Test Coverage & Endpoint Parity (NON-NEGOTIABLE)

Every MCP tool and every portal endpoint touched by the crawler MUST be tested
with full coverage and full parity:

- **100% Code Coverage**: Line and branch coverage MUST be 100% across all
  source files. No exceptions, no exclusions, no `istanbul ignore` pragmas
- **Full Portal Endpoint Parity**: For every data.egov.bg endpoint the system
  consumes, there MUST be a corresponding contract test that validates:
  - Request shape (path, query parameters, headers, required vs optional)
  - Response shape (success payloads, error payloads, status codes)
  - Pagination behavior (page tokens, offsets, result counts)
  - Rate limiting and error code handling
- **Dataset Schema Parity**: Every dataset family in the Dataset Schema Catalog
  MUST have a fixture-based round-trip test (fetch → store → expose via MCP)
  that asserts the schema is preserved exactly
- **Contract Test Traceability**: Every contract test MUST reference the
  specific portal endpoint or Dataset Schema Catalog entry it validates
- **Parity Matrix**: A machine-readable parity matrix
  (`tests/parity-matrix.json`) MUST be maintained mapping every consumed portal
  endpoint and every catalog entry to its contract test. CI MUST fail if any
  entry lacks a corresponding test
- **No Tool Without Tests**: It MUST be impossible to merge an MCP tool that
  lacks 100% contract test coverage. CI MUST enforce this gate
- **Regression Safety**: Any portal behavior change (detected via contract test
  failure) MUST be triaged, documented, and either adapted or reported upstream

**Rationale**: This server is the AI agent's sole interface to Bulgarian open
data. A single untested code path or missing endpoint contract can cause
silent failures or — worse — silently wrong answers about public data. 100%
coverage and full parity are the minimum bar.

### IX. Data Freshness & Sync Integrity (NON-NEGOTIABLE)

The local mirror MUST be honest about what it knows and when it last knew it:

- **Per-Record Freshness**: Every dataset and every resource in the local
  store MUST carry a `last_synced_at` timestamp and a `source_etag_or_hash`
  (when available) recorded at sync time
- **Freshness in Responses**: Every MCP read response that returns dataset or
  resource content MUST include a freshness block (`last_synced_at`,
  `source_last_modified` if known, `is_stale` flag against the configured
  freshness SLO)
- **Live Sync Where Supported**: The crawler MUST use the most incremental
  mechanism the portal exposes (modified-since filters, change feeds, ETags,
  conditional requests) before falling back to scheduled full re-crawl
- **Deletion & Rename Detection**: The sync pipeline MUST detect upstream
  deletions and renames and reflect them in the local store with explicit
  tombstones or rename records. MCP responses MUST surface these states rather
  than silently 404-ing or returning a stale prior version as if current
- **No Silent Staleness**: It MUST NOT be possible for an MCP read to return
  data older than the configured freshness SLO without an explicit `is_stale`
  flag and the upstream timestamp
- **Sync Audit Trail**: Every sync run MUST produce a structured audit record
  (datasets seen, added, updated, deleted, errors) retained for a minimum
  retention window defined in the plan

**Rationale**: A mirror that lies about freshness is worse than no mirror — AI
agents will confidently quote stale public data. Honesty about provenance and
recency is a core product feature, not an afterthought.

### X. Bulgarian-Locale Awareness

The system MUST treat Bulgarian as a first-class concern:

- **UTF-8 / Cyrillic End-to-End**: All ingestion, storage, indexing, and MCP
  responses MUST handle Cyrillic correctly. Tests MUST include Cyrillic
  fixtures and MUST assert byte-exact preservation
- **Authoritative Fields Untouched**: Original Bulgarian metadata fields
  (titles, descriptions, organisation names, tags, categories) MUST be
  preserved exactly as published. The system MUST NOT translate, transliterate,
  or otherwise rewrite authoritative fields
- **Derived Helpers Are Marked**: If the system exposes English-language
  helpers (translations, transliterations, derived summaries), these MUST be
  served in clearly distinct fields labelled as derived/translated and MUST
  NOT shadow or replace the authoritative Bulgarian field
- **Locale-Aware Search**: Search and filter operations MUST handle Bulgarian
  collation, case folding, and common typographic variants (е/ѣ legacy forms,
  й/и confusion, etc.) at minimum to the degree the underlying store supports
- **Documentation in English, Data in Source Language**: Code, comments, specs,
  and contracts are written in English. Data content is preserved in its
  source language

**Rationale**: This is a Bulgarian open-data project. Mishandling Cyrillic or
silently anglicizing metadata would corrupt the corpus and destroy trust with
both Bulgarian users and AI agents that need verifiable provenance.

### XI. Respectful Crawling (NON-NEGOTIABLE)

The crawler MUST be a good citizen of data.egov.bg:

- **robots.txt**: The crawler MUST fetch and honor `robots.txt` and MUST
  re-check it on a regular cadence
- **Rate Limiting**: The crawler MUST enforce a configurable per-host request
  rate. Defaults MUST be conservative (well below any plausible portal
  capacity) and MUST be tightened — never loosened — automatically in response
  to errors
- **Identifying User-Agent**: All requests MUST send a User-Agent string that
  identifies the project, its version, and a contact email or URL where the
  portal operators can reach the maintainers
- **Conditional Requests**: The crawler MUST use conditional requests (ETag,
  If-Modified-Since) when supported to avoid re-downloading unchanged content
- **Exponential Backoff**: On `5xx`, `429`, or network errors, the crawler MUST
  back off exponentially with jitter and MUST stop after a configurable
  failure budget rather than hammering the portal
- **No Parallel Hammering**: The crawler MUST NOT open more than a configurable
  small number of concurrent connections to the portal
- **Off-Hours Bias Where Practical**: For full re-crawls, scheduling SHOULD
  prefer off-peak hours for Bulgaria (overnight Europe/Sofia) when possible
- **No Auth Bypass, No Scraping Around Limits**: The crawler MUST NOT attempt
  to circumvent rate limits, IP blocks, or authentication — if the portal
  signals "stop", the crawler stops

**Rationale**: data.egov.bg is a public good operated on public funds. Causing
load problems or appearing to abuse the service would harm both the project
and the broader open-data ecosystem in Bulgaria. Respectful crawling is a
hard constraint, not an optimization.

## Technology Stack

**Locked Stack** (optimized for fastest feedback loops):

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Runtime | Bun 1.x | 4x faster startup, native TypeScript, all-in-one toolchain |
| Language | TypeScript 5.x (strict mode) | Type safety, MCP SDK compatibility |
| MCP SDK | @modelcontextprotocol/sdk ^1.25.x | Official MCP implementation |
| HTTP Client | Bun fetch / `undici`-class client | For portal crawling with conditional requests, retries, backoff |
| Validation | Zod ^3.25.x | Runtime validation, TypeScript inference |
| Local Store | Single durable, queryable store with migrations (concrete choice — e.g., SQLite, Postgres, or object store + index — deferred to plan-time) | Owned mirror of the portal corpus; MUST support transactions, schema migrations, and full-text or trigram search over Cyrillic content |
| Testing | Vitest | Fast, TypeScript-native, Bun-compatible |
| Linting/Formatting | Biome | 100x faster than ESLint+Prettier, zero config |
| Coverage | @vitest/coverage-v8 | V8-native coverage, enforced at 100% line + branch |
| API Reference | `specs/portal-api/` | Full data.egov.bg endpoint shape documentation |
| Dataset Catalog | `specs/dataset-schemas/` | Per-dataset schema catalog (grown as datasets are crawled) |

**Package Management**: bun (lockfile committed, `bun.lock` / `bun.lockb`)

**Why Bun over Node.js**:

- Native TypeScript execution (no transpilation step)
- Built-in bundler, test runner, package manager
- 4x faster cold start, 25x faster package installs
- Drop-in Node.js API compatibility
- Aligns with Principle VI: Fast Feedback Loops

**Local store selection criteria** (to be resolved at plan-time, justified in
`plan.md`):

- MUST support transactions
- MUST support schema migrations checked into the repo
- MUST support efficient queries over `last_synced_at` and source identifiers
- MUST handle UTF-8 / Cyrillic correctly in indexes and full-text search
- SHOULD be operationally simple to deploy (single binary or managed service)

## Development Workflow

### Feature Lifecycle

1. **Spec**: Product defines WHAT in `specs/[###-feature]/spec.md`
2. **Plan**: Engineering defines HOW in `specs/[###-feature]/plan.md`
3. **Tasks**: Break down into atomic tasks in `specs/[###-feature]/tasks.md`
4. **Implement**: AI/Engineer executes tasks, validates via tests
5. **Review**: Automated checks + optional human review
6. **Deploy**: Merge to main → tagged release

### Quality Gates

| Gate | Requirement | Enforcement |
|------|-------------|-------------|
| Spec Approval | Product sign-off on WHAT | Branch protection |
| Tests Pass | All unit/integration/contract tests green | CI mandatory |
| Coverage | 100% line and branch coverage | CI mandatory (`vitest --coverage`) |
| Endpoint Parity | All consumed portal endpoints + cataloged datasets have contract tests | CI mandatory (parity-matrix check) |
| Sync Integrity | Sync pipeline preserves data and freshness metadata for the fixture corpus end-to-end | CI mandatory (sync-integrity test stage) |
| Type Check | Zero TypeScript errors | CI mandatory |
| Lint/Format | Zero Biome violations | Pre-commit + CI |
| Crawler Etiquette | Test suite asserts User-Agent, rate limits, backoff, robots.txt handling | CI mandatory |
| Locale Safety | Cyrillic round-trip tests pass; no authoritative-field rewrites | CI mandatory |
| Constitution Compliance | Spec/Plan reference principles | Manual/AI review |

### Branching Strategy

- `main`: Production-ready, always releasable
- `feature/###-name`: Feature branches from main
- No long-lived branches; merge within 48 hours or rebase
- Squash merges for clean history

## Governance

This Constitution is the supreme governance document for danni-bg. All
practices, tools, and decisions MUST comply.

### Amendment Process

1. Propose change via PR to `.specify/memory/constitution.md`
2. Document rationale and impact assessment
3. Update dependent templates if principles change
4. Approve by project owner (or designated governance role)
5. Increment version per semantic rules:
   - **MAJOR**: Removes/redefines principles (breaking)
   - **MINOR**: Adds principles or expands guidance
   - **PATCH**: Clarifications, typos, non-semantic fixes

### Compliance

- All PRs MUST pass Constitution Check (automated where possible)
- Violations MUST be documented with justification if exception granted
- Quarterly constitution review: evaluate principle relevance, remove obsolete
  rules, audit that the parity matrix and dataset catalog are still in sync
  with reality

### Guidance Files

- Runtime development guidance: `.specify/templates/` (templates for specs,
  plans, tasks, checklists)
- Command definitions: `.claude/skills/` (speckit skills)
- Portal API reference: `specs/portal-api/`
- Dataset schema catalog: `specs/dataset-schemas/`

**Version**: 1.0.0 | **Ratified**: 2026-05-08 | **Last Amended**: 2026-05-08
