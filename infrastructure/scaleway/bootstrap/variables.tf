variable "project_id" {
  description = "Existing bootstrap project that owns the remote Terraform state bucket."
  type        = string
}

variable "region" {
  description = "Scaleway Object Storage region."
  type        = string
  default     = "fr-par"
}

variable "state_bucket_name" {
  description = "Globally unique private bucket name for Terraform state."
  type        = string

  validation {
    condition     = can(regex("^evorto-terraform-state-[a-z0-9-]+$", var.state_bucket_name))
    error_message = "state_bucket_name must start with evorto-terraform-state- and contain only lowercase DNS-safe characters."
  }
}
