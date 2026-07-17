variable "environment" {
  description = "Application environment name."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "project_id" {
  description = "Scaleway project dedicated to this environment."
  type        = string
}

variable "tem_project_id" {
  description = "Shared project that owns notifications.evorto.app in Transactional Email."
  type        = string
}

variable "region" {
  type = string
}

variable "zone" {
  type = string
}

variable "hostname" {
  description = "Only tenant hostname exposed by the environment."
  type        = string
}

variable "bucket_suffix" {
  description = "Globally unique, lowercase suffix appended to environment bucket names."
  type        = string
}

variable "container_image" {
  description = "Existing immutable image reference used to create the containers. Deployment workflows own later revisions."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.container_image))
    error_message = "container_image must be an immutable sha256 digest reference."
  }
}

variable "schema_database_password" {
  description = "Write-only password for the schema owner used only by the ops role."
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "runtime_database_password" {
  description = "Write-only password for the least-privilege application runtime user."
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "database_node_type" {
  type = string
}

variable "database_is_ha" {
  type = bool
}

variable "database_backup_retention_days" {
  type = number
}

variable "database_volume_size_gb" {
  type    = number
  default = 10
}

variable "web_min_scale" {
  type = number
}

variable "cockpit_trace_retention_days" {
  type    = number
  default = 30
}

variable "cockpit_log_retention_days" {
  type    = number
  default = 30
}

variable "cockpit_metric_retention_days" {
  type    = number
  default = 30
}

variable "alert_email" {
  description = "Operational destination for Cockpit alerts."
  type        = string
}
