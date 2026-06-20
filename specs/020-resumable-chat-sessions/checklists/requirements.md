# Requirements checklist — Persistent & resumable chat sessions

Retrospective verification of the shipped feature against its requirements.

- [X] CHK001 Questions persisted before the turn; replies (with citations/anchors) on completion (FR-063/064)
- [X] CHK002 Conversations + messages are per-user; list/read/delete owner-only, others 404 (FR-065, SC-004)
- [X] CHK003 List (newest first), open-to-resume, delete; titled by first question (FR-066/067)
- [X] CHK004 Sticky grounding context persisted + restored across turns (FR-068)
- [X] CHK005 Turn runs detached; client disconnect does not abort generation (FR-069)
- [X] CHK006 Reconnect re-attaches: snapshot replay → live → done/error (FR-070, SC-003)
- [X] CHK007 Server-side stop aborts the model call (FR-071)
- [X] CHK008 Last open conversation restored on reload; auto re-attach if still streaming (FR-072, SC-001/002)
- [X] CHK009 In-memory limit documented; persisted data survives restart (FR-073)
- [X] CHK010 FR-019 ("never persist") supersession recorded in spec + plan (Clarifications)
- [X] CHK011 Hermetic tests for store, manager, and routes; suite green (SC-005)

## Complexity / deviations

- Reverses the prior **FR-019** ("conversations are NEVER persisted server-side"). Justified: chat is
  gated behind login (spec 019); only the authenticated owner's own conversations are stored.
- Generation registry is **in-memory / single-process** (FR-073). A durable job queue would be needed
  to survive a server restart; deliberately out of scope.
