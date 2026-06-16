# Implementation Plan: Centre document reader + debounced search + server-side grid

**Branch**: `009-center-document-reader` | **Date**: 2026-06-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/009-document-reader-grid/spec.md`

**Note**: Retrospective plan documenting work shipped in PR #13 (merged 2026-06-12). Status: Implemented.

## Summary

A UX-and-correctness pass on the 008 explorer's data-reading and search experience. Three threads: (1) move the dataset resource drilldown out of the cramped 340px left panel into a centre **document reader** (`ResourceReader`) that overlays the still-mounted map; (2) promote free-text dataset search to a dedicated, **300ms-debounced search bar** (`SearchBar`) and remove it from the filter panel; (3) give tabular resources spreadsheet-style **sort + per-column filter applied server-side over the whole resource** (not just the loaded page), via new query params on `GET …/rows` and a pure, unit-tested read helper `src/read/resource-grid.ts`.

**Technical approach**: Reuse the existing 008 stack untouched at the persistence and transport layers. The reader is a Zustand store target (`reader: ReaderTarget | null`) rendered as an absolute overlay sibling of the map, reusing the existing `ResourcePreview` via a new `variant: 'panel' | 'reader'`. Grid sort/filter is a pure function module (`applyGrid` = filter→sort, numeric-aware, Bulgarian-locale, blanks-last, stable) bound to disk rows inside the existing `readResourceRows`, gated by a 100k-row scan cap with a `gridTruncated` flag; the HTTP route parses `sort`/`dir`/`filters` (tolerating malformed JSON) and passes a `GridQuery` through `ReadBridge.rows`. Both debounces are local `useEffect` timers; no new store, schema, migration, or portal endpoint.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Bun 1.x (backend + tooling); same TS for the React frontend  
**Primary Dependencies**: Backend — Hono (existing `apps/explorer-api`), reuse of in-repo `src/read/resource-rows.ts`; new pure helper `src/read/resource-grid.ts`. Frontend — React, Zustand (existing `explorerStore`), `lucide-react` icons (ArrowLeft/ArrowUp/ArrowDown/Search/X/Loader2); reuse of `lib/chart`, `lib/table`, `lib/cn`  
**Storage**: Read-only reuse of the existing `bun:sqlite` mirror + on-disk curated artifacts via `readResourceRows`. No new persistent storage, no migration  
**Testing**: `bun:test` / Vitest-style for pure logic at 100% (`tests/unit/read/resource-grid.test.ts`, `apps/explorer-web/src/lib/grid.test.ts`); Testing Library for components; Playwright for E2E (reader open/close, sort/filter behaviour) — mirror fixtures for the offline loop  
**Target Platform**: Self-hostable Linux service (Bun backend serving the static SPA), desktop-first modern browsers  
**Project Type**: Web application (frontend SPA + backend API) — incremental change to the existing 008 `apps/explorer-api` + `apps/explorer-web` packages  
**Performance Goals**: Search fires once per ~300ms pause (not per keystroke); grid sort/filter over the whole resource bounded to a 100k-row scan; closing the reader is instant (map never unmounted)  
**Constraints**: Read-only and faithful to authoritative data (no fabrication); Cyrillic-safe ordering (`localeCompare(…, 'bg')`) and authoritative BG fields shown verbatim (Constitution X); never bulk-load million-row resources — scan cap + honest `gridTruncated` flag (Constitution IX honesty about partial results); all new logic pure and covered at 100% (Constitution VIII)  
**Scale/Scope**: Individual resources up to ~1.25M rows (sort/filter capped at first 100k, flagged); 3 user stories (P1, P1, P2), 16 functional requirements; ~17 files changed (13 web/api source + 2 test + 1 contract doc update + 1 read helper)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. AI-Native / read-only, faithful | ✅ Pass | Pure read extension over `src/read`; sort/filter never mutate or fabricate data; resource content is shown verbatim |
| II. Spec-Driven Development | ✅ Pass | WHAT in spec.md, HOW here + data-model/contracts; this is the retrospective record of PR #13 |
| III. Contract-First | ✅ Pass | The new `/rows` `sort`/`dir`/`filters` params + `gridTruncated` field are documented in `specs/008-map-data-explorer/contracts/http-api.md` (updated in PR #13) and re-stated in this feature's `contracts/rows-grid.md`; no invented abstractions — `GridQuery` maps directly to the rows endpoint |
| IV. Operational Excellence | ✅ Pass | Malformed `filters` JSON is tolerated (ignored) rather than crashing the request; no secrets touched; reuses existing structured logging/error mapping |
| V. Simplicity & YAGNI | ✅ Pass | One component reused for panel + reader via a `variant` prop; pure helpers over the existing read path; no new store/schema/migration/endpoint; debounces are local timers |
| VI. Fast Feedback Loops | ✅ Pass | Pure logic unit-tested in `bun:test` (sub-second); Vite HMR; offline mirror fixtures; E2E for the rendered behaviour |
| VII. Type Safety & Validation | ✅ Pass | TS strict; `GridQuery`/`GridSort`/`ReaderTarget` typed; route validates `dir` to `asc|desc` and parses/guards `filters` to string-valued plain-object keys only |
| VIII. 100% Coverage & Parity | ✅ Pass | All new logic is pure and 100% covered (`resource-grid`, `grid` helpers); reader/search-bar render behaviour validated by Playwright E2E under the existing 008 render-glue allowance; no new WebGL glue introduced |
| IX. Data Freshness & Sync Integrity | ✅ Pass | Reuses the existing freshness block on the rows response; the new `gridTruncated` flag is an honesty signal — a sort/filter over a >100k-row resource is never presented as complete |
| X. Bulgarian-Locale Awareness | ✅ Pass | Text ordering uses `localeCompare(value, 'bg')`; filtering is case-insensitive substring over Cyrillic; authoritative fields shown verbatim; UI strings in Bulgarian, code/comments in English |
| XI. Respectful Crawling | ➖ N/A | No portal crawling; reads the local mirror only |

**Gate result**: PASS. No new constitution deviations beyond 008's already-documented, bounded render-glue exception (which this feature does not extend).

## Project Structure

### Documentation (this feature)

```text
specs/009-document-reader-grid/
├── plan.md              # This file
├── spec.md              # WHAT (user stories, FRs, success criteria)
├── research.md          # Phase 0 decisions (R1–R6)
├── data-model.md        # Phase 1: store target + grid query/result shapes
├── quickstart.md        # Phase 1: run/dev/test + manual verification
├── contracts/
│   └── rows-grid.md     # /rows sort/filter/grid query-param + response contract
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 (grouped by user story; marked done)
```

### Source Code (repository root)

Incremental change to the existing 008 web/api packages plus one new pure read helper under the shared `src/read`. No new packages.

```text
apps/
├── explorer-api/
│   └── src/
│       ├── app.ts               # /rows route: parse sort/dir/filters → GridQuery (CHANGED)
│       └── read-bridge.ts       # ReadBridge.rows(...) gains optional grid param (CHANGED)
└── explorer-web/
    └── src/
        ├── App.tsx              # mounts <SearchBar/> + <ResourceReader/>; loading state (CHANGED)
        ├── datasets/
        │   ├── ResourceReader.tsx   # centre document reader overlay (NEW)
        │   ├── ResourcePreview.tsx  # variant panel|reader; sort header + filter row (CHANGED)
        │   └── DatasetDetail.tsx    # resource click → openReader; active highlight (CHANGED)
        ├── filters/
        │   ├── SearchBar.tsx        # prominent debounced dataset search (NEW)
        │   └── FilterPanel.tsx      # free-text search removed (CHANGED)
        ├── lib/
        │   ├── grid.ts              # cycleSort, hasActiveFilters (pure, NEW)
        │   ├── grid.test.ts         # unit tests for grid helpers (NEW)
        │   └── api.ts               # fetchResourceRows gains GridQuery; serialises params (CHANGED)
        ├── store/
        │   └── explorerStore.ts     # ReaderTarget + reader/openReader/closeReader (CHANGED)
        └── types.ts                # ResourceContent.gridTruncated? (CHANGED)

src/read/
├── resource-grid.ts             # pure server-side filter→sort + scan cap (NEW)
└── resource-rows.ts             # readResourceRows applies grid before pagination (CHANGED)

tests/unit/read/
└── resource-grid.test.ts        # unit tests for compareCells/filterRows/sortRows/applyGrid (NEW)

specs/008-map-data-explorer/contracts/
└── http-api.md                  # /rows grid query params + gridTruncated documented (CHANGED)
```

**Structure Decision**: Reuse the 008 web-application shape unchanged. The server-side grid logic lives in the shared `src/read` tree (alongside `resource-rows.ts`) so it sits on the same in-process read substrate the MCP tools use, not inside the explorer API package — keeping the read contract single-sourced. The UI changes are confined to existing `apps/explorer-web` modules plus two new files (`ResourceReader.tsx`, `SearchBar.tsx`). No new packages, store, schema, or endpoint.

## Complexity Tracking

> No new violations. This feature introduces no new constitution deviation. The only standing deviation in this area is 008's bounded Principle VIII render-glue exception for MapLibre/WebGL paint, which this feature does not extend (it adds no new render glue; all new code is pure logic covered at 100% or behaviour validated by E2E).

## Phase Outputs

- **Phase 0** → `research.md` (R1–R6: reader-overlay vs. unmount, one-component-two-variants, server-side vs. client-side grid, scan cap + truncation flag, debounce mechanics, numeric/locale parity).
- **Phase 1** → `data-model.md`, `contracts/rows-grid.md`, `quickstart.md`.
- **Phase 2** → `tasks.md` (grouped by user story; all tasks marked done with real file paths).

## Post-Design Constitution Re-Check

Re-evaluated after the implementation: the `/rows` grid contract is documented before/alongside code (III); the rows freshness block is preserved and `gridTruncated` adds honesty about partial scans (IX); `GridQuery`/`GridSort` are typed and the route guards `dir`/`filters` (VII); ordering is Bulgarian-locale-aware and authoritative content is verbatim (X); the change is a thin, pure extension of `src/read` with no new store (I, V). No new violations. **Gate still PASS.**
