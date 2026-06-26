# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via GitHub's [**Private vulnerability reporting**](https://github.com/danni-bg/danni-bg/security/advisories/new)
(Security → Report a vulnerability), or by email to **valentin.yanakiev@gmail.com**.

Include: a description, steps to reproduce / PoC, affected version or commit, and impact. We aim to
acknowledge within a few business days and will coordinate a fix + disclosure timeline with you.

## Scope

This repository is the danni **application** (open core, EUPL-1.2). The deployment/hosting
infrastructure is maintained separately; vulnerabilities in a hosted instance should be reported to its
operator.

## Good to know

- Secrets are never committed (`.env`, `*.auto.tfvars`, `backend.*.tfvars` are gitignored); the
  container entrypoint runs a placeholder-secret gate for non-dev profiles.
- The chat is backend-mediated — the browser never calls the LLM or the mirror tools directly.
