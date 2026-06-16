# Requirements Quality Checklist: Trustworthy grounded chat

**Purpose**: Validate that the spec for 017-grounded-chat is complete, unambiguous, testable, and traceable before sign-off.
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md)

## Anti-fabrication & grounding (the core responsibility)

- [X] CHK001 The spec states the chat MUST answer only from injected rows / tool results and never fabricate values (FR-016, FR-033, FR-035)
- [X] CHK002 The distinction between *tool scope* and *row grounding* is explicit and unambiguous (FR-036; data-model "groundingDatasetIds vs scope.datasetIds")
- [X] CHK003 The always-cite-grounded-dataset rule is captured, including the no-tool-call case (FR-034, US1 scenario 2)
- [X] CHK004 The system-prompt hardening (no value absent verbatim; no fabricating to agree) is a stated requirement, not just prose (FR-035)
- [X] CHK005 Both the tool-loop and RAG fallback are required to inject grounding (FR-033, US1 scenario 3)

## Sticky context & history window

- [X] CHK006 Sticky `contextDatasetIds` (source, dedup, cap=2) is specified (FR-039)
- [X] CHK007 Grounding precedence (explicit > reader > sticky) and matching carry-forward are specified (FR-038)
- [X] CHK008 The history window (message-count + char budget, keeps last message) is specified and bounded (FR-040)
- [X] CHK009 It is stated that grounding rows live in the system prompt so trimming the transcript is safe (FR-040, research R3)

## Auto-focus / reader & bounds

- [X] CHK010 The `groundingDatasetIds` request field and the web client sending the open reader's id are specified (FR-037)
- [X] CHK011 The район / sub-municipal recall gap is explained (value-only, not indexed) and tied to grounding (Clarifications Q4, research R4, SC-003)
- [X] CHK012 Injection bounds (≤1000 rows/resource, 90k total chars, partial flag) are specified and measurable (FR-041, SC-004)

## Value-filter

- [X] CHK013 `readResource` `filters` (exact column → case-insensitive substring, whole-resource scan, only matching rows, independent of inject budget) is specified (FR-042, SC-005)
- [X] CHK014 Exposing column names + resourceId in the focus block is specified (FR-043, US4 scenario 2)

## Provider config & secrets

- [X] CHK015 Default-provider config via `EXPLORER_DEFAULT_*` env, committed `.env.example`, gitignored `.env`, tool-calling requirement are specified (FR-044, Setup, SC-006)
- [X] CHK016 Secret handling (per-request, never persisted/logged server-side) is consistent with FR-024 (FR-044)

## Quality, testability & honesty

- [X] CHK017 Every FR (FR-033…FR-044) is specific and verifiable; none contain `NEEDS CLARIFICATION` or unresolved placeholders
- [X] CHK018 Success criteria SC-001…SC-008 are measurable and technology-agnostic (e.g. "0% invented values"; "район question returns real rows not 'no data'")
- [X] CHK019 User stories are prioritised P1–P4 with Why / Independent Test / Given-When-Then acceptance scenarios
- [X] CHK020 Key Entities cover Conversation/sticky context, the focus context block, and ChatRequest fields
- [X] CHK021 Edge cases cover user pressure, unreadable resource, oversized dataset, empty rows, no-data, район-only terms, tool-shy model, non-tool provider
- [X] CHK022 The model-faithfulness caveat is stated plainly in Assumptions (grounding robust by construction; exact/exhaustive completeness depends on a more faithful model; never fabricates)
- [X] CHK023 Constitution alignment is cited precisely (FR-016 grounding/no-fabrication, FR-024 secret handling, FR-019 session-only, FR-023 provider errors, FR-025 scope; principles I/VII/VIII/IX/X)

## Notes

- All items pass: this checklist validates a retrospective spec for shipped, merged work (PRs #22/#26/#27/#28/#29).
- FR numbering continues the explorer chat series from feature 008 (which ended at FR-032); this feature adds FR-033…FR-044.
