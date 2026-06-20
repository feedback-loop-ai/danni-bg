# Implementation Plan: Account & chat-UX polish

**Status**: Implemented (retrospective). PRs: #50 (user settings page), #51 (avatar menu + display
name + visible header links), #52 (remove duplicate theme toggle), #55 (profile pictures + GitHub
link), #56 (chat input layout), #57 (chat button tooltips). Iterative + feedback-driven.

## Architecture

- **Avatar menu** (`auth/UserMenu.tsx`): a self-contained dropdown (click-outside / Escape / item
  close — no dropdown dep) rendering the identity (name/email + role) + Настройки / Платформа(admin) /
  Изход. `AuthWidget` shows it when signed in, else a "Вход" link; both use `text-primary-foreground`
  (the earlier links were `text-primary` = blue-on-blue, invisible).
- **Display name** flows backend → UI: `kratosSessionResolver` derives it from `traits.name`
  (`displayNameFromTraits`); `readAuth` reads an optional `X-User-Name`; `requireAuth` threads it into
  `findOrCreateByKratosId`, which refreshes `display_name` via COALESCE (a nameless session keeps the
  stored name); the auth callback returns `displayName` (+ `avatarUrl`); `AuthContext.AuthUser` carries it.
- **Profile picture**: `AvatarUpload` resizes the chosen file to a 256² `data:` URL client-side and
  PUTs `/api/me/avatar` (validated `data:image/(png|jpeg|webp)`, ≤ ~600 KB); stored in `users.avatar_url`
  (migration 012); the menu/settings avatar renders the image, else initials.
- **Settings page** (`KratosFlow` `kind='settings'`): a full account page — an **Облик** section
  (`lib/theme.ts`), a **Снимка** section (AvatarUpload), a **Употреба** section (SelfUsage, spec 021),
  and the Kratos method groups (Профил / Парола / Passkeys) each as their own labelled form so they
  submit independently and re-render in place.
- **Theme**: chosen in settings; the header `ThemeToggle` was removed. `App` still applies the saved
  theme on the map page (and follows the OS in `system` mode). Single source: `lib/theme.ts`.
- **Header GitHub link** (`App`): an octocat anchor sized to the avatar, opening the repo.
- **Chat panel** (`ChatPanel`): no "Чат" header; the new-chat ＋ (left) + send ↑ (right) live in the
  input bar with `group-hover` tooltips + `hover:scale-110 active:scale-95`. The in-chat provider
  override (`ProviderSettings` / `providerStorage`) was deleted; the chat always sends the
  server-default provider.

## Endpoints / contracts

- `PUT /api/me/avatar` ({ avatarUrl: data-url | null }) — set/clear the picture (validated, capped).
- `POST /api/auth/callback` (delta) — returns `displayName` + `avatarUrl` on the user.

## Phases (as delivered)

- **#50** — user settings page (sections; single-Save password fix → full account page).
- **#51** — avatar dropdown `UserMenu`; visible header links; display-name wiring (resolver →
  callback) + COALESCE refresh.
- **#52** — remove the duplicate header theme toggle (settings owns appearance).
- **#55** — migration 012 + `users.avatar_url` + `PUT /api/me/avatar`; `AvatarUpload`; header GitHub
  link. (Also carried the spec-021 quota-policy work.)
- **#56** — chat input layout (drop "Чат" header, ＋ in the bar, hover animation).
- **#57** — chat button tooltips. (Also carried the spec-021 max-output config.)

## Decisions

- Avatar **dropdown** over a flat link row (cleaner, fits the narrow panel); native link/button roles
  kept (only the trigger advertises `aria-haspopup`/`aria-expanded`).
- Display name in the **app DB** (derived from Kratos traits), consistent with spec 019's "roles +
  profile in the app, minimal Kratos identity".
- Picture as a **size-capped data URL** in the row (simple; no file hosting) — small enough for the
  session payload.
- **Removed the per-user provider override** — it predated admin LLM config + metering and would
  bypass both.

## Testing

e2e (Playwright, hermetic stubs) + web-unit (`bun:test`): us8/us9 updated for the Настройки/Платформа
split and the avatar-menu open; chat e2e for the input layout; the settings flow renders all sections.
Live on `:8790`: menu legible + name/picture shown; settings sections work; chat bar shows ＋/↑ +
tooltips, no provider settings.
