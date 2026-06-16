# Requirements Quality Checklist: New conversation + suggested-prompt empty state

**Purpose**: Validate that the spec for `011-chat-new-conversation` is complete,
unambiguous, testable, and free of leaked implementation detail before it is
treated as the source of truth.
**Created**: 2026-06-13
**Feature**: [spec.md](../spec.md)

## Requirement Completeness

- [X] CHK001 Every functional requirement (FR-001…FR-012) maps to at least one
  user-story acceptance scenario or edge case in spec.md.
- [X] CHK002 The reset's *exclusions* are specified, not just its effects — FR-007
  states which explorer state MUST be preserved (filters, region, reader,
  provider).
- [X] CHK003 The disabled condition for the control is fully enumerated
  (FR-008: empty AND not streaming AND no focus AND no error).
- [X] CHK004 The empty-state visibility rule is bidirectional — shown while
  empty (FR-009) and hidden once any message exists (FR-011).
- [X] CHK005 Behaviour of clicking a suggestion is specified, including the
  ignore-while-streaming guard (FR-010, edge case).

## Requirement Clarity & Measurability

- [X] CHK006 Each success criterion (SC-001…SC-005) is measurable and
  technology-agnostic (counts, single-action, preserved/unchanged), naming no
  framework or component.
- [X] CHK007 Functional requirements describe observable behaviour, not code —
  no function names, state-variable names, or icons appear in FRs/SCs (those
  live in plan.md / data-model.md).
- [X] CHK008 The "new conversation = new session, not saved history" semantic is
  stated explicitly (Overview + Assumptions) so it cannot be misread as a
  history list.
- [X] CHK009 Cyrillic / Bulgarian-locale requirement for all new strings is
  explicit (FR-012) per Constitution Principle X.

## Consistency & Traceability

- [X] CHK010 The dependency on feature 008 FR-019 (session-only conversations)
  is cited where it constrains this feature (Overview, Assumptions, FR-003).
- [X] CHK011 Key Entities cover all data referenced by the requirements
  (Conversation, Suggested prompt, Chat-driven map highlight) without inventing
  persisted entities.
- [X] CHK012 No contradictory requirements — reset clears chat-driven state and
  explicitly preserves the rest; no FR both clears and preserves the same state.

## Scope & Edge Cases

- [X] CHK013 Scope boundary is explicit: frontend-only, no backend/contract/data
  change (Assumptions; mirrored in plan.md Constitution Check III and
  contracts/.gitkeep).
- [X] CHK014 Mid-stream reset is covered as an edge case and tied to FR-004 (the
  abort MUST NOT surface as an error).
- [X] CHK015 The "nothing to reset" idle case is covered (disabled control,
  edge case + FR-008 + SC-005).
- [X] CHK016 The "suggestion clicked while streaming" case is covered (edge
  case + FR-010 guard).

## User Stories

- [X] CHK017 Each user story is prioritized (US1 P1, US2 P2) with a Why, an
  Independent Test, and Given/When/Then acceptance scenarios.
- [X] CHK018 Each story is independently testable — US1 (reset) and US2 (empty
  state) can each be verified without the other.

## Notes

- All items verified against the merged implementation in PR #15
  (`apps/explorer-web/src/chat/ChatPanel.tsx`). This is a retrospective
  checklist; items are checked because the shipped behaviour matches the
  documented requirements.
