# Terraform settings + providers (spec 031, FR-141). Remote state with locking lives in an S3-compatible
# backend (Hetzner Object Storage works) — configured at `init` time via -backend-config so no secrets
# are committed:
#   terraform init -backend-config=backend.hcloud.tfvars
terraform {
  required_version = ">= 1.6"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.49"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state + locking (FR-141). Values supplied via -backend-config (bucket, key, endpoints,
  # access keys) so nothing sensitive is in version control. Comment out to use local state for a
  # throwaway dev apply.
  backend "s3" {
    # bucket                      = "danni-tfstate"
    # key                         = "danni/terraform.tfstate"
    # region                      = "eu-central-1"  # placeholder; Hetzner ignores it (skip flags below)
    # endpoints = { s3 = "https://nbg1.your-objectstorage.com" }  # copy the EXACT endpoint from the console
    # access_key / secret_key via AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or -backend-config
    # skip_credentials_validation = true
    # skip_region_validation      = true
    # skip_requesting_account_id  = true
    # use_path_style              = true
    # use_lockfile                = true  # S3-native state locking (Hetzner has no DynamoDB)
  }
}

provider "hcloud" {
  token = var.hcloud_token
}
