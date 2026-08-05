variable "bootstrap_project_id" {
  description = "Existing bootstrap project that owns the remote Terraform state bucket."
  type        = string
}

variable "organization_id" {
  description = "Scaleway organization that owns the Evorto projects."
  type        = string
}

variable "tem_project_id" {
  description = "Existing shared project that owns notifications.evorto.app in Transactional Email."
  type        = string
}

variable "region" {
  description = "Scaleway Object Storage region."
  type        = string
  default     = "fr-par"
}

variable "state_bucket_names" {
  description = "Globally unique private bucket names for the three isolated Terraform roots."
  type = object({
    bootstrap  = string
    production = string
    staging    = string
  })

  validation {
    condition = alltrue([
      for name in values(var.state_bucket_names) :
      can(regex("^evorto-terraform-state-[a-z0-9-]+$", name))
    ])
    error_message = "Every state bucket name must start with evorto-terraform-state- and contain only lowercase DNS-safe characters."
  }

  validation {
    condition     = length(toset(values(var.state_bucket_names))) == 3
    error_message = "Bootstrap, staging, and production must use three different state bucket names."
  }
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for evorto.app. Authentication comes only from CLOUDFLARE_API_TOKEN."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_zone_id))
    error_message = "cloudflare_zone_id must be a 32-character lowercase hexadecimal Cloudflare zone ID."
  }
}

variable "validate_tem_dns" {
  description = "Set only after the managed SPF, DKIM, MX, and DMARC records exist."
  type        = bool
  default     = false
}

variable "monthly_budget_eur" {
  description = "Optional organization billing budget alert threshold in EUR."
  type        = number
  default     = null
  nullable    = true
}
