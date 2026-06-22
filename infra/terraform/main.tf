# Hetzner Cloud + k3s (spec 031, FR-141/145/146). One `apply` brings up a private-networked k3s cluster
# (control plane + N agents) reachable over TLS once the k8s manifests (../k8s) are applied; `destroy`
# removes it cleanly (SC-E1). Sizing is per-env via envs/*.tfvars (SC-E3). The app tier is horizontally
# scalable by raising agent_count + the Deployment/HPA replicas (FR-145).

locals {
  name        = "danni-${var.env}"
  subnet_cidr = "10.0.1.0/24"
  server_ip   = "10.0.1.10" # fixed private IP for the control plane (agents join via this)
  labels      = { app = "danni", env = var.env, managed_by = "terraform" }
}

# Shared cluster join secret (never committed; lives only in state, which is the encrypted remote backend).
resource "random_password" "k3s_token" {
  length  = 48
  special = false
}

resource "hcloud_network" "this" {
  name     = local.name
  ip_range = "10.0.0.0/16"
  labels   = local.labels
}

resource "hcloud_network_subnet" "this" {
  network_id   = hcloud_network.this.id
  type         = "cloud"
  network_zone = var.network_zone
  ip_range     = local.subnet_cidr
}

# Edge firewall: SSH + k3s API locked to admin CIDRs; HTTP/S open for the ingress; node-to-node traffic
# rides the private network (FR-143). The cluster CNI handles intra-cluster policy (see ../k8s).
resource "hcloud_firewall" "this" {
  name   = local.name
  labels = local.labels

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.allowed_ssh_cidrs
  }
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "6443"
    source_ips = var.allowed_ssh_cidrs
  }
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_placement_group" "this" {
  name   = local.name
  type   = "spread"
  labels = local.labels
}

resource "hcloud_server" "control_plane" {
  name               = "${local.name}-cp"
  server_type        = var.control_plane_type
  image              = "ubuntu-24.04"
  location           = var.location
  placement_group_id = hcloud_placement_group.this.id
  ssh_keys           = var.ssh_key_names
  firewall_ids       = [hcloud_firewall.this.id]
  labels             = merge(local.labels, { role = "control-plane" })

  user_data = templatefile("${path.module}/templates/k3s-server.sh.tftpl", {
    k3s_version = var.k3s_version
    k3s_token   = random_password.k3s_token.result
    private_ip  = local.server_ip
  })

  network {
    network_id = hcloud_network.this.id
    ip         = local.server_ip
  }

  depends_on = [hcloud_network_subnet.this]
}

resource "hcloud_server" "agent" {
  count              = var.agent_count
  name               = "${local.name}-agent-${count.index}"
  server_type        = var.agent_type
  image              = "ubuntu-24.04"
  location           = var.location
  placement_group_id = hcloud_placement_group.this.id
  ssh_keys           = var.ssh_key_names
  firewall_ids       = [hcloud_firewall.this.id]
  labels             = merge(local.labels, { role = "agent" })

  user_data = templatefile("${path.module}/templates/k3s-agent.sh.tftpl", {
    k3s_version       = var.k3s_version
    k3s_token         = random_password.k3s_token.result
    server_private_ip = local.server_ip
    private_ip        = cidrhost(local.subnet_cidr, 20 + count.index)
  })

  network {
    network_id = hcloud_network.this.id
    ip         = cidrhost(local.subnet_cidr, 20 + count.index)
  }

  depends_on = [hcloud_server.control_plane]
}
