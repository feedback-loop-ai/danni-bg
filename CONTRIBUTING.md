# Contributing to danni

Thanks for your interest! danni is the **open core** (EUPL-1.2) of an open-data explorer + grounded
chat over [data.egov.bg](https://data.egov.bg/). This repo is the application; the commercial
deployment layer lives elsewhere.

## Dev setup

Requires [Bun](https://bun.sh) ≥ 1.3 and Docker (for the local identity stack).

```sh
bun install
docker compose up -d            # Ory Kratos + Mailpit (for gated chat / accounts)
bun run db:migrate              # apply migrations (the server does NOT auto-migrate)
bun run explorer:api            # API on :8790
cd apps/explorer-web && bun run dev   # SPA on :5173
```

To populate the map/list/chat you need data: `bun run danni sync` → `curate` → `index`
(see `specs/001-egov-data-sync/quickstart.md`). A real embedder/LLM is configured via a gitignored
`.env` (see `.env.example`).

## Before you open a PR

All of these must pass (CI enforces them):

```sh
bun run lint        # biome
bun run typecheck   # tsc --noEmit
bun test            # bun:test (the locked test runner — see the constitution)
```

- **New logic needs tests.** Keep them hermetic (in-memory SQLite, no live network).
- **Match the surrounding code** — comment density, naming, idioms.
- Don't commit secrets. `.env`, `*.auto.tfvars`, and `backend.*.tfvars` are gitignored.

## How we work (spec-driven)

Non-trivial features go through a spec under `specs/NNN-name/` (spec.md → plan.md → tasks.md), using the
Spec Kit skills. The project constitution (`.specify/memory/constitution.md`) is authoritative —
notably, the test runner is locked to `bun:test`.

## PRs & commits

- Branch off `main`; open a PR. CI (`build-test`) must be green before merge.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, …).
- Keep PRs focused; update the relevant spec/docs when behavior changes.

## Licensing of contributions

By contributing, you agree your contributions are licensed under the project's **EUPL-1.2**
(inbound = outbound). Please confirm you have the right to submit the code.

## Security

Do **not** open public issues for vulnerabilities — see [SECURITY.md](./SECURITY.md).
