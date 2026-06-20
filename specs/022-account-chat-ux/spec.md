# Feature Specification: Account & chat-UX polish

**Feature Branch**: `022-account-chat-ux`
**Created**: 2026-06-20
**Status**: Implemented (shipped in PRs #50, #51, #52, the account parts of #55, #56, and the UX parts
of #57 on `main`; verified by the suite green + live runs on `:8790`)
**Input**: Retrospective spec for already-merged work. On top of the identity foundation (spec 019),
give signed-in users a real account surface — an avatar menu, a full settings page, a display name,
a profile picture — plus chat-panel UX polish. Iterative, feedback-driven.

## Clarifications

### Session 2026-06-19/20

- Q: How is the signed-in user represented in the header? → A: An **avatar dropdown** (initials or
  picture) showing name/email + role, with links to **Настройки** (and **Платформа** for admins) and
  **Изход**. Header links were blue-on-blue (invisible) and are fixed to the header foreground.
- Q: Where do account settings live? → A: `/auth/settings` is a **full account page** with sections:
  **Облик** (light/dark/system), **Профил** (name), **Парола**, **Passkeys**, and **Употреба** (usage,
  from spec 021). Reached from the avatar menu.
- Q: Why didn't the name show? → A: the session resolver only read id/email/verified, so
  `display_name` was always null. The **display name is now derived from Kratos `traits.name`** and
  threaded through (resolver → find-or-create → callback), shown in the menu + initials.
- Q: Profile picture? → A: users can **upload/remove a picture**, resized client-side to a small
  `data:` URL (size-capped), shown in the avatar (falls back to initials).
- Q: Theme controls? → A: appearance is chosen **in settings (Облик)**; the duplicate header theme
  toggle was removed (one source of truth via `lib/theme.ts`).
- Q: Chat input layout? → A: dropped the redundant **"Чат"** header; the **new-chat (＋)** control
  sits in the input bar (left), send on the right, both with hover tooltips + a hover/press animation.
- Q: Keep the per-user in-chat LLM provider override? → A: **No, removed.** With the admin-configured
  endpoint (spec 019) + metering (spec 021), a per-user BYO provider made no sense — the chat always
  uses the server default.

## User Scenarios & Testing *(mandatory)*

One responsibility: **a coherent account surface for signed-in users + chat-panel polish.**

### User Story 1 — Account menu & settings (Priority: P2)

A signed-in user opens an avatar dropdown (name + role + email), goes to a settings page to edit their
name/password, manage passkeys, pick an appearance, and see their usage. Admins also get a Платформа
link. Logout is in the menu.

### User Story 2 — Identity polish (Priority: P2)

The user's real name (from registration) shows in the menu + initials; they can upload a profile
picture that appears as their avatar; the header links to the project's GitHub repo.

### User Story 3 — Chat-panel UX (Priority: P3)

The chat panel has no redundant header; the new-chat (＋) and send (↑) controls live in the input bar
with tooltips and a subtle hover animation; there's no per-user provider override.

### Edge Cases

- No name set → initials/menu fall back to the email; the email line is omitted when a name is shown.
- `canvas.toDataURL('image/webp')` unsupported → falls back to PNG (the server accepts png/jpeg/webp,
  size-capped).
- Appearance chosen in settings is applied on the map page on return (shared `lib/theme.ts`).

## Requirements *(mandatory)*

- **FR-083**: A signed-in user's header control MUST be an avatar dropdown showing name/email + role,
  with links to settings (and the platform page for admins) and logout, legible on the header.
- **FR-084**: The user's display name MUST be derived from Kratos `traits.name` and used in the menu
  + avatar initials (falling back to email when absent).
- **FR-085**: A user MUST be able to upload and remove a profile picture (resized client-side to a
  size-capped `data:` image), shown as their avatar.
- **FR-086**: `/auth/settings` MUST be a full account page: appearance, profile (name), password,
  passkeys, and usage — each section submitting independently.
- **FR-087**: Appearance (light/dark/system) MUST be selectable in settings; the duplicate header
  theme toggle MUST be removed (single source of truth).
- **FR-088**: The header MUST link to the project's GitHub repository.
- **FR-089**: The chat input bar MUST host the new-chat (＋) control (left) and send (right) with
  hover tooltips + a hover/press animation; the redundant "Чат" header MUST be removed.
- **FR-090**: The per-user in-chat LLM provider override MUST be removed; the chat MUST always use the
  admin-configured server default (so it can't bypass platform config + metering).

## Success Criteria *(mandatory)*

- **SC-001**: The avatar dropdown opens and its links/email/role are legible against the header.
- **SC-002**: After registering with a name, the menu + initials show that name.
- **SC-003**: Uploading a picture shows it as the avatar; removing it reverts to initials.
- **SC-004**: The settings page renders all sections; profile/password save independently; appearance
  toggles the theme.
- **SC-005**: The chat input bar shows ＋/↑ with tooltips; no "Чат" header; no provider settings.
- **SC-006**: Covered by the e2e + web-unit suites (auth/admin link assertions, settings, chat),
  suite green.

## Key Entities

- **users.display_name** — derived from Kratos `traits.name` (column from spec 019; wiring added here).
- **users.avatar_url** — optional profile picture (data: URL); migration 012.
- **theme preference** — client-side `light|dark|system` (`lib/theme.ts`, localStorage + `.dark` class).
