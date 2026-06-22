# acceptance sizing (spec 031): the pre-prod gate — identical code to prod, smaller (SC-E3). Two
# cx33 nodes (4 vCPU / 8 GB; control plane is schedulable, app pods spread across both).
env                = "acceptance"
location           = "nbg1"
control_plane_type = "cx33"
agent_type         = "cx33"
agent_count        = 1

# SSH + k3s API (22 + 6443) locked to the admin IP (update + re-apply if it changes).
allowed_ssh_cidrs = ["79.100.6.166/32"]

# Existing Hetzner SSH keys (managed centrally in the project) attached to the nodes.
ssh_key_names = ["Valentin FIDO2 YubiKey", "Valentin GPG Yubikey"]
