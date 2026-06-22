# staging sizing (spec 031): one agent — same modules as prod, smaller (SC-E3).
env                = "staging"
location           = "nbg1"
control_plane_type = "cx22"
agent_type         = "cx22"
agent_count        = 1
# allowed_ssh_cidrs = ["203.0.113.4/32"]
# ssh_public_keys   = ["ssh-ed25519 AAAA... you@host"]
