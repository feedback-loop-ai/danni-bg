# Tasks: Account & chat-UX polish

Retrospective — all delivered.

## Account surface

- [X] T001 [WEB] user settings page — `/auth/settings` as a full account page; single-Save fix → sections (PR #50).
- [X] T002 [WEB] avatar dropdown `UserMenu`; `AuthWidget` shows it signed-in (PR #51).
- [X] T003 [FIX] header links legible (`text-primary-foreground`, was blue-on-blue) (PR #51).
- [X] T004 [API] display name from Kratos `traits.name`: `displayNameFromTraits` in the resolver,
  `X-User-Name` in `readAuth`, threaded into find-or-create (COALESCE refresh), returned by callback (PR #51).
- [X] T005 [DATA/API] migration 012 `users.avatar_url`; `UsersRepo.setAvatar`; `PUT /api/me/avatar`
  (validated, capped); callback returns `avatarUrl` (PR #55).
- [X] T006 [WEB] `AvatarUpload` (client resize → data URL); avatar shows the picture or initials (PR #55).
- [X] T007 [WEB] header GitHub link, sized to the avatar (PR #55).

## Appearance

- [X] T008 [WEB] appearance picker in settings (Облик), reusing `lib/theme.ts` (PR #50).
- [X] T009 [WEB] remove the duplicate header theme toggle; `App` still applies the saved theme (PR #52).

## Chat-panel UX

- [X] T010 [WEB] drop the "Чат" header; new-chat ＋ in the input bar (left), send right; hover/press
  animation (PR #56); ＋ icon per feedback.
- [X] T011 [WEB] hover tooltips on new-chat / send / stop (PR #57).
- [X] T012 [WEB] remove the in-chat provider override (`ProviderSettings`/`providerStorage`); always
  send the server default (PR #55-adjacent / chat cleanup).

## Verification

- [X] e2e (us8/us9 link split + avatar-menu open; chat layout) + web-unit green.
- [X] Live on `:8790`: menu legible + name/picture; settings sections; ＋/↑ + tooltips; no provider UI.
