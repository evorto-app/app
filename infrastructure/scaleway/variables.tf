variable "organization_id" {
  description = "Scaleway organization that owns the Evorto projects."
  type        = string
}

variable "tem_project_id" {
  description = "Existing shared project that owns notifications.evorto.app in Transactional Email."
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
  description = "Globally unique lowercase suffix for all non-state Object Storage buckets."
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

variable "staging_container_image" {
  description = "Initial immutable staging image. Workflows own subsequent image revisions."
  type        = string
}

variable "staging_schema_database_password" {
  type        = string
  description = "Write-only staging schema-owner password."
  sensitive   = true
  ephemeral   = true
}

variable "staging_runtime_database_password" {
  type        = string
  description = "Write-only staging runtime-user password."
  sensitive   = true
  ephemeral   = true
}

variable "production_enabled" {
  description = "Binding production provisioning gate. Keep false until the separate enablement decision."
  type        = bool
  default     = false
}

variable "production_container_image" {
  description = "Immutable production-registry image copied from an accepted staging manifest."
  type        = string
  default     = null
  nullable    = true
}

variable "production_schema_database_password" {
  type        = string
  description = "Write-only production schema-owner password. Required only when production_enabled is true."
  default     = null
  nullable    = true
  sensitive   = true
  ephemeral   = true
}

variable "production_runtime_database_password" {
  type        = string
  description = "Write-only production runtime-user password. Required only when production_enabled is true."
  default     = null
  nullable    = true
  sensitive   = true
  ephemeral   = true
}

variable "validate_tem_dns" {
  description = "Set only after the externally managed SPF, DKIM, MX, and DMARC records exist."
  type        = bool
  default     = false
}

variable "monthly_budget_eur" {
  description = "Optional organization billing budget alert threshold in EUR."
  type        = number
  default     = null
  nullable    = true
}
