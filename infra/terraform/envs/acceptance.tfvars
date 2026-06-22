# acceptance sizing (spec 031): the pre-prod gate — identical code to prod, smaller (SC-E3). Two
# cx32 nodes (control plane is schedulable, app pods spread across both).
env                = "acceptance"
location           = "nbg1"
control_plane_type = "cx32"
agent_type         = "cx32"
agent_count        = 1

# SSH + k3s API (22 + 6443) locked to the admin IP (update + re-apply if it changes).
allowed_ssh_cidrs = ["79.100.6.166/32"]

ssh_public_keys = [
  # YubiKey (FIDO2) — interactive admin / break-glass (touch required)
  "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAINwDiMGwZNoE1MvcPlGAdpF1bP8yXNAzXo0enzeYT/4XAAAABHNzaDo= vyanakiev@100.68.70.61",
  # On-disk ed25519 — non-interactive automation (e.g. kubeconfig fetch)
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINs3gonzThyAzPVv2xEAp8T3HVHZgFhKSj+gAq7VMvZq vyanakiev@vyanakiev-workstation-hetzner-20260512",
]
