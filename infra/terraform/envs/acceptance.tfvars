# acceptance sizing (spec 031): the pre-prod gate — identical code to prod, smaller (SC-E3). Two
# cx32 nodes (control plane is schedulable, app pods spread across both).
env                = "acceptance"
location           = "nbg1"
control_plane_type = "cx32"
agent_type         = "cx32"
agent_count        = 1
# allowed_ssh_cidrs = ["203.0.113.4/32"]
# ssh_public_keys   = ["ssh-ed25519 AAAA... you@host"]
