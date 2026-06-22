#!/usr/bin/env bash
# Install the cluster operators danni's manifests need (spec 031/032), then you can `kubectl apply -k
# overlays/<env>`. Idempotent (helm upgrade --install) — safe to re-run.
#
# k3s ALREADY bundles traefik (ingress), metrics-server (HPA), and the local-path StorageClass, so this
# only installs cert-manager (TLS) + the External Secrets Operator (OpenBao-backed secrets). The OpenBao
# instance itself lives in a separate repo; configure its k8s-auth role for this cluster before the
# ExternalSecrets can sync.
#
# Usage:
#   export KUBECONFIG=/path/to/kubeconfig.yaml      # point at the target cluster
#   ACME_EMAIL=you@example.org ./install-operators.sh acceptance
#
# Optional overrides: CERT_MANAGER_VERSION, ESO_VERSION (bump as new releases land).
set -euo pipefail

ENV="${1:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.16.2}"
ESO_VERSION="${ESO_VERSION:-0.10.4}"

die() {
  echo "error: $*" >&2
  exit 1
}

case "$ENV" in
acceptance | prod) ;;
*) die "usage: ACME_EMAIL=you@example.org $0 <acceptance|prod>" ;;
esac
[ -n "$ACME_EMAIL" ] || die "set ACME_EMAIL (Let's Encrypt registration address)"
command -v helm >/dev/null || die "helm not found"
command -v kubectl >/dev/null || die "kubectl not found"
kubectl cluster-info >/dev/null 2>&1 || die "kubectl can't reach a cluster — is KUBECONFIG set?"

CTX="$(kubectl config current-context 2>/dev/null || echo '?')"
echo "==> Target context: ${CTX}   (env=${ENV})"
echo "    cert-manager ${CERT_MANAGER_VERSION} + external-secrets ${ESO_VERSION}"

# --- sanity: confirm k3s already provides the bundled bits (informational) ---
echo "==> k3s-bundled components:"
for d in traefik metrics-server local-path-provisioner; do
  if kubectl -n kube-system get deploy "$d" >/dev/null 2>&1; then
    echo "    ✓ $d present"
  else
    echo "    ! $d NOT found in kube-system — install it if this isn't k3s"
  fi
done

# --- cert-manager (TLS at the edge) ---
echo "==> Installing cert-manager"
helm repo add jetstack https://charts.jetstack.io --force-update >/dev/null
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --version "$CERT_MANAGER_VERSION" \
  --set crds.enabled=true \
  --wait

echo "==> Creating the letsencrypt-prod ClusterIssuer (HTTP-01 via traefik)"
# NOTE: a cert only ISSUES once DNS points the host at the ingress IP and :80 is reachable. For
# rate-limit-safe testing, swap the server for the staging endpoint:
#   https://acme-staging-v02.api.letsencrypt.org/directory
kubectl apply -f - <<YAML
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ${ACME_EMAIL}
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            ingressClassName: traefik
YAML

# --- External Secrets Operator (OpenBao-backed secrets) ---
echo "==> Installing the External Secrets Operator"
helm repo add external-secrets https://charts.external-secrets.io --force-update >/dev/null
helm upgrade --install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace \
  --version "$ESO_VERSION" \
  --set installCRDs=true \
  --wait

cat <<DONE

==> Operators installed.

Next:
  1. Ensure OpenBao is reachable + its k8s-auth role 'danni' trusts this cluster and the
     danni-secrets ServiceAccount (separate repo), and the danni/${ENV} namespace holds the
     secret/{app,kratos} entries. Set the real OpenBao 'server' in base/externalsecrets.yaml.
  2. Point DNS for the ${ENV} host at the ingress, then deploy:
       kubectl apply -k infra/k8s/overlays/${ENV}
       kubectl -n danni-${ENV} rollout status deploy/danni-app
DONE
