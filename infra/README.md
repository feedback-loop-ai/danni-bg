# Infrastructure (spec 031) — provision & orchestrate where danni runs

Two layers, both as code:

- `terraform/` — provisions a private-networked **k3s** cluster on **Hetzner Cloud** (control plane + N
  agents), per environment. One `apply` up, one `destroy` down (SC-E1).
- `k8s/` — portable **Kustomize** manifests (base + `overlays/{acceptance,prod}`) that run the app,
  Kratos (internal), its Postgres, ingress/TLS, NetworkPolicies, HPA/PDB, and secrets — on *any*
  cluster, not just k3s.

What gets *shipped* onto this is **spec 030** (the app image + release pipeline); what we *watch* on it
is **spec 032**. This spec is the platform itself.

## 0. Prerequisites

- A Hetzner Cloud project + API token (`export TF_VAR_hcloud_token=...` — never commit it).
- An S3-compatible bucket for Terraform remote state (Hetzner Object Storage works).
- A secret backend for runtime secrets: **OpenBao** (shared, multi-tenant via namespaces — the default
  `SecretStore` targets the `danni/<env>` namespace). The CI secret gate (spec 030 FR-136) still blocks
  placeholder secrets.

## 1. Provision the cluster (FR-141)

```sh
cd infra/terraform
terraform init -backend-config=backend.hcloud.tfvars      # remote state + locking
terraform apply -var-file=envs/prod.tfvars                # acceptance|prod — same code, sized params (SC-E3)
# fetch the kubeconfig (see the kubeconfig_hint output)
ssh root@$(terraform output -raw control_plane_ipv4) cat /etc/rancher/k3s/k3s.yaml \
  | sed "s/127.0.0.1/$(terraform output -raw control_plane_ipv4)/" > kubeconfig.yaml
export KUBECONFIG=$PWD/kubeconfig.yaml
```

`terraform destroy -var-file=envs/<env>.tfvars` tears it down cleanly (SC-E1). Two environments:
**acceptance** (pre-prod gate, smaller) and **prod** — same modules, sized via tfvars (SC-E3). Scale
acceptance agents/replicas down off-hours to save cost (FR-146).

## 2. Install the cluster operators (once per cluster)

The manifests assume these are present:

- **cert-manager** + a `letsencrypt-prod` ClusterIssuer (TLS at the edge, FR-143).
- **External Secrets Operator** + **OpenBao** (FR-144): set the OpenBao `server` in
  `k8s/base/externalsecrets.yaml`, configure OpenBao's k8s auth to trust this cluster + bind the
  `danni-secrets` ServiceAccount to a `danni` role, and store the `app` + `kratos` secrets under the
  `danni/<env>` namespace's `secret/` kv mount. (The OpenBao instance itself lives in a separate repo.)
- **metrics-server** (for the HorizontalPodAutoscaler) — already bundled by k3s, like **traefik**
  (ingress class) and the **local-path** default StorageClass; no install needed on k3s.

## 3. Deploy the app (FR-142)

```sh
# Substitute the real host into the Kratos config (base_url / return URLs / passkey rp), then apply:
kubectl apply -k k8s/overlays/prod
```

- Health-gated rolling deploys via the `/readyz` + `/healthz` probes (spec 030); `maxUnavailable: 0`.
- **Rollback**: `kubectl rollout undo deployment/danni-app -n danni-prod` (revisionHistoryLimit keeps
  prior ReplicaSets).
- **Self-heal** (SC-E2): a killed pod is rescheduled by the orchestrator; ≥2 replicas (prod) keep
  serving during node loss; the PodDisruptionBudget protects availability during drains.

> **Host substitution.** The Kratos config (`k8s/base/config/kratos.yaml`) carries `danni.example.org`
> as the public host. Substitute the per-env host at render time (e.g. `envsubst`, a CI step, or an
> overlay-local `configMapGenerator`) before `kubectl apply`. The Ingress host is patched by each
> overlay; keep the two in sync.

## 4. Scaling (FR-145)

- **Vertical/horizontal nodes**: raise `agent_count` (+ `*_type`) in the env tfvars, `apply`.
- **App replicas**: the overlay `replicas` + the HPA (`minReplicas`/`maxReplicas`) drive pod count.
- **Precondition for >1 app replica**: the app/control-plane tables must live in **Postgres** (specs
  029/030 + the `db-architecture-decision` memo) and the rate-limit/quota store must be **shared**
  (spec 028). Until then the read substrate (SQLite) is **per-node, read-only** — a baked image layer
  or a read-only shared volume refreshed by the sync pipeline, never a shared writable file.

## 5. Secrets & backups (FR-144 / FR-147)

- Secrets come only from the secret backend via External Secrets — never committed or baked (SC-E4).
  Rotate by updating the backend; the operator re-syncs and pods pick it up on restart.
- Both stateful services are private-network-only (NetworkPolicies) with backups wired to spec 030
  FR-139: the Kratos Postgres `pg_dump` CronJob here, plus Litestream for the SQLite store (see
  `docs/OPERATIONS.md`). Point backup replicas at object storage for off-cluster retention.

## Success criteria → where

| | |
|---|---|
| SC-E1 one apply up / destroy down over TLS | `terraform/` + `k8s` ingress + cert-manager |
| SC-E2 self-heal, no downtime ≥2 replicas | Deployment + HPA + PDB + placement-group spread |
| SC-E3 acceptance/prod from identical code | `overlays/*` + `envs/*.tfvars` (only params differ) |
| SC-E4 no baked/committed secrets; rotatable | External Secrets + CI secret gate (spec 030) |
