# dev sizing (spec 031, FR-146): smallest, control-plane-only by default — cheap to stand up + tear down.
env                = "dev"
location           = "nbg1"
control_plane_type = "cx22"
agent_type         = "cx22"
agent_count        = 0
# allowed_ssh_cidrs = ["203.0.113.4/32"]  # lock to your admin IP
# ssh_public_keys   = ["ssh-ed25519 AAAA... you@host"]
