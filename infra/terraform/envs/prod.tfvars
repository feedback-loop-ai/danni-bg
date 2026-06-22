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
# allowed_ssh_cidrs = ["203.0.113.0/24"]  # restrict SSH + k3s API to admin network
# ssh_public_keys   = ["ssh-ed25519 AAAA... ops@danni"]
