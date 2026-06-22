# prod sizing (spec 031): multiple agents for HA app replicas (SC-E2) + headroom for the HPA (FR-145).
env                = "prod"
location           = "nbg1"
control_plane_type = "cx32"
agent_type         = "cx32"
agent_count        = 2
# allowed_ssh_cidrs = ["203.0.113.0/24"]  # restrict SSH + k3s API to admin network
# ssh_public_keys   = ["ssh-ed25519 AAAA... ops@danni"]
