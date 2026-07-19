terraform {
  required_version = "= 1.15.8"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.22.0"
    }

    scaleway = {
      source  = "scaleway/scaleway"
      version = "= 2.77.1"
    }
  }

  backend "s3" {
    region                      = "fr-par"
    key                         = "evorto/platform.tfstate"
    use_lockfile                = true
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    endpoints = {
      s3 = "https://s3.fr-par.scw.cloud"
    }
  }
}

provider "cloudflare" {}

provider "scaleway" {
  region = var.region
  zone   = var.zone
}
