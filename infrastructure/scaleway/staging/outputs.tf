output "platform" {
  value = {
    application_bucket         = module.environment.application_bucket
    cockpit                    = module.environment.cockpit
    containers                 = module.environment.containers
    deployment_metadata_bucket = module.environment.deployment_metadata_bucket
    project_id                 = var.project_id
    role_secret_ids            = module.environment.role_secret_ids
  }
}

output "database" {
  value     = module.environment.database
  sensitive = true
}

output "managed_dns_record" {
  description = "Staging record reconciled in the existing authoritative Cloudflare zone."
  value = {
    name  = cloudflare_dns_record.web.name
    type  = cloudflare_dns_record.web.type
    value = cloudflare_dns_record.web.content
  }
}
