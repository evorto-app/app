variable "project_id" {
  description = "Bootstrap-owned production project ID."
  type        = string
}

variable "deployer_application_id" {
  description = "Bootstrap-owned production deployer application ID."
  type        = string
}

variable "web_application_id" {
  description = "Bootstrap-owned production web application ID."
  type        = string
}

variable "worker_application_id" {
  description = "Bootstrap-owned production worker application ID."
  type        = string
}

variable "tem_project_id" {
  description = "Shared project that owns notifications.evorto.app in Transactional Email."
  type        = string
}

variable "region" {
  type    = string
  default = "fr-par"
}

variable "zone" {
  type    = string
  default = "fr-par-1"
}

variable "bucket_suffix" {
  description = "Globally unique lowercase suffix for the production Object Storage buckets."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{4,30}[a-z0-9]$", var.bucket_suffix))
    error_message = "bucket_suffix must be 6-32 lowercase DNS-safe characters."
  }
}

variable "alert_email" {
  description = "Operational address used by Cockpit alert contact points."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for evorto.app. Authentication comes only from CLOUDFLARE_API_TOKEN."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_zone_id))
    error_message = "cloudflare_zone_id must be a 32-character lowercase hexadecimal Cloudflare zone ID."
  }
}

variable "container_image" {
  description = "Immutable production image copied from an accepted staging manifest."
  type        = string
}

variable "schema_database_password" {
  type        = string
  description = "Write-only production schema-owner password."
  sensitive   = true
  ephemeral   = true
}

variable "schema_database_password_version" {
  type        = number
  description = "Monotonic production schema-owner password version."
  default     = 1
}

variable "runtime_database_password" {
  type        = string
  description = "Write-only production runtime-user password."
  sensitive   = true
  ephemeral   = true
}

variable "runtime_database_password_version" {
  type        = number
  description = "Monotonic production runtime-user password version."
  default     = 1
}
