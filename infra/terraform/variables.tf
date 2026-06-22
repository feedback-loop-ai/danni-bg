# Inputs (spec 031). acceptance/prod differ only by tfvars (envs/*.tfvars) → SC-E3 parity.

variable "hcloud_token" {
  description = "Hetzner Cloud API token (provide via TF_VAR_hcloud_token or the secret manager — never commit)."
  type        = string
  sensitive   = true
}

variable "env" {
  description = "Environment name (acceptance|prod). Used to label + name resources."
  type        = string
  validation {
    condition     = contains(["acceptance", "prod"], var.env)
    error_message = "env must be one of: acceptance, prod."
  }
}

variable "location" {
  description = "Hetzner location (EU for data residency): nbg1/fsn1 (DE) or hel1 (FI)."
  type        = string
  default     = "nbg1"
}

variable "network_zone" {
  description = "Hetzner network zone matching the location."
  type        = string
  default     = "eu-central"
}

variable "control_plane_type" {
  description = "Server type for the k3s control-plane node."
  type        = string
  default     = "cx22"
}

variable "agent_type" {
  description = "Server type for k3s agent (worker) nodes."
  type        = string
  default     = "cx22"
}

variable "agent_count" {
  description = "Number of k3s agent nodes. 0 = control-plane-only (cheap dev); non-prod can scale down."
  type        = number
  default     = 1
}

variable "k3s_version" {
  description = "Pinned k3s version (INSTALL_K3S_VERSION) for reproducible clusters."
  type        = string
  default     = "v1.31.4+k3s1"
}

variable "ssh_key_names" {
  description = "Names of EXISTING Hetzner SSH keys to grant node access (managed centrally in the project, not created here)."
  type        = list(string)
  default     = []
}

variable "allowed_ssh_cidrs" {
  description = "CIDRs allowed to reach SSH (22) + the k3s API (6443). Lock to your admin IPs."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
