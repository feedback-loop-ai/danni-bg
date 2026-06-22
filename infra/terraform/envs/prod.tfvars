# prod sizing (spec 031): two cx43 nodes (8 vCPU / 16 GB each). The k3s server is schedulable, so the
# control plane + the one agent BOTH run app pods → 2 replicas spread across 2 nodes for self-heal
# (SC-E2). Split off a dedicated (unscheduled) control plane later if API-server contention shows up in
# the metrics. NOTE: `curate` runs OFF-cluster — it would OOM these nodes; ship/restore the SQLite store
# to the per-node read volume (FR-145, docs/OPERATIONS.md).
env                = "prod"
location           = "nbg1"
control_plane_type = "cx43"
agent_type         = "cx43"
agent_count        = 1

# SSH + k3s API (22 + 6443) locked to the admin IP. NOTE: a dynamic/residential IP that changes will
# lock you out until you update this + re-apply.
allowed_ssh_cidrs = ["79.100.6.166/32"]

# Existing Hetzner SSH keys (managed centrally in the project) attached to the nodes.
ssh_key_names = ["Valentin FIDO2 YubiKey", "Valentin GPG Yubikey"]
