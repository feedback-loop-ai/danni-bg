# Feature Specification: Secret, image & private-network delivery

**Feature Branch**: `033-secret-image-network-delivery`
**Created**: 2026-06-23
**Status**: **Implemented** (manifests + CI; runtime depends on the external `vault` repo — OpenBao +
Headscale — and a live cluster)
**Input**: Retrofit — provisioning danni on the spec-031 cluster surfaced gaps spec 030/031 left open:
how the app *image* reaches the cluster, how it pulls a *private* image, how *secrets* arrive, and how
the cluster reaches the secret backend *without exposing it*. This spec captures that delivery layer.

## Overview

Close the loop between "image built / secrets stored" and "pods running" on the spec-031 platform,
using the shared OpenBao (the `feedback-loop-ai/vault` repo) as the secret backend and a self-hosted
Headscale tailnet as the private path to it. Single responsibility: **deliver the image, the pull
credential, the secrets, and the private network path** the running app needs.

## Requirements

- **FR-155**: Environments are **acceptance** (pre-prod gate) + **prod** — dev dropped. Same Terraform
  modules + Kustomize base, sized via `envs/*.tfvars` + `overlays/*` (prod = 2× cx43; SC-E3 parity).
- **FR-156**: **Image delivery** — CI builds the app image and pushes to **GHCR** after the test gate
  (`ghcr.io/feedback-loop-ai/danni-app`): push to main → `:edge`/`:acceptance`/`:sha`; tag `vX.Y.Z` →
  `:X.Y.Z`/`:stable`/`:latest`. Overlays pin the tag (acceptance tracks `:acceptance`; prod `:stable`).
- **FR-157**: **Private image pull** — the GHCR package is private; the app pod pulls via an
  `imagePullSecret` (`ghcr-pull`, a `dockerconfigjson`) sourced from OpenBao (`secret/ghcr`) by ESO.
- **FR-158**: **Secret delivery** — app + Kratos secrets arrive via the External Secrets Operator from
  OpenBao, scoped to the per-environment namespace `danni/<env>` (k8s-auth role `danni` → the
  `danni-secrets` ServiceAccount → a read policy). NO secret *values* live in git.
- **FR-159**: **Private networking** — ESO reaches OpenBao ONLY over the self-hosted Headscale tailnet,
  via an in-cluster Tailscale **egress proxy** (`components/openbao-egress`); OpenBao's `:8200` is never
  exposed publicly. (The Tailscale K8s *operator* is not used — it needs Tailscale's SaaS OAuth API,
  which Headscale doesn't implement; a plain `tailscale` container with `--login-server` + an ephemeral
  pre-auth key is the Headscale-compatible equivalent.)

## Success criteria

- **SC-G1**: A merge to main publishes a pullable `ghcr.io/.../danni-app:acceptance`; a `vX.Y.Z` tag
  publishes `:stable`.
- **SC-G2**: The app pod pulls the **private** image (via `ghcr-pull`) and starts.
- **SC-G3**: ESO materializes `danni-app-secrets` + `danni-kratos-secrets` from OpenBao with no plaintext
  in git; acceptance can't read prod's secrets (separate OpenBao namespaces).
- **SC-G4**: OpenBao is unreachable from the public internet; ESO reaches it only over the tailnet.

## Out of scope / dependencies

- The **OpenBao server**, its namespaces/policies/roles, and the **Headscale** coordinator live in the
  `feedback-loop-ai/vault` repo. This spec is the danni-cluster *consumer* side.
- Builds on **030** (image/Dockerfile/CI gate), **031** (the cluster), **028/029** (per-key/org usage).
- Bootstrap objects created out-of-band (not from OpenBao): the `tailscale-auth` pre-auth key + the
  `openbao-ca` ConfigMap.
