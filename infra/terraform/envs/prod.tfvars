# prod sizing (spec 031): two cx42 nodes (8 vCPU / 16 GB each). The k3s server is schedulable, so the
# control plane + the one agent BOTH run app pods → 2 replicas spread across 2 nodes for self-heal
# (SC-E2). Split off a dedicated (unscheduled) control plane later if API-server contention shows up in
# the metrics. NOTE: `curate` runs OFF-cluster — it would OOM these nodes; ship/restore the SQLite store
# to the per-node read volume (FR-145, docs/OPERATIONS.md).
env                = "prod"
location           = "nbg1"
control_plane_type = "cx42"
agent_type         = "cx42"
agent_count        = 1

# SSH + k3s API (22 + 6443) locked to the admin IP. NOTE: a dynamic/residential IP that changes will
# lock you out until you update this + re-apply.
allowed_ssh_cidrs = ["79.100.6.166/32"]

ssh_public_keys = [
  # YubiKey (FIDO2) — interactive admin / break-glass (touch required)
  "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAINwDiMGwZNoE1MvcPlGAdpF1bP8yXNAzXo0enzeYT/4XAAAABHNzaDo= vyanakiev@100.68.70.61",
  # On-disk ed25519 — non-interactive automation (e.g. kubeconfig fetch)
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINs3gonzThyAzPVv2xEAp8T3HVHZgFhKSj+gAq7VMvZq vyanakiev@vyanakiev-workstation-hetzner-20260512",
]
