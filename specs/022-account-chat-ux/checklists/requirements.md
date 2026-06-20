# Requirements checklist — Account & chat-UX polish

- [X] CHK001 Avatar dropdown with identity + settings/platform/logout, legible on the header (FR-083, SC-001)
- [X] CHK002 Display name derived from Kratos traits.name; menu + initials; email fallback (FR-084, SC-002)
- [X] CHK003 Upload/remove profile picture (client-resized, capped); shown as avatar (FR-085, SC-003)
- [X] CHK004 /auth/settings full account page (appearance/profile/password/passkeys/usage), independent saves (FR-086, SC-004)
- [X] CHK005 Appearance selectable in settings; duplicate header toggle removed (FR-087)
- [X] CHK006 Header links to the GitHub repo (FR-088)
- [X] CHK007 Chat input bar hosts ＋/↑ with tooltips + hover animation; "Чат" header removed (FR-089, SC-005)
- [X] CHK008 In-chat provider override removed; server default always used (FR-090)
- [X] CHK009 e2e + web-unit cover the link split, avatar menu, settings, and chat layout; suite green (SC-006)

## Notes

- Builds on spec 019 (identity, gated chat) and references spec 021 (the Употреба section). Passkeys +
  link-mode recovery + single-port magic links were part of the 019 identity arc (PR #49) and are not
  re-specified here.
- Profile pictures are stored inline as a size-capped data URL (no file hosting); display name lives
  in the app DB derived from the Kratos identity, consistent with spec 019's split.
