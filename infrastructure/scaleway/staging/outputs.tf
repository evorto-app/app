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

output "web_dns_record" {
  description = "Unproxied staging CNAME to maintain in the authoritative DNS zone."
  value = {
    name  = "staging.evorto.app"
    type  = "CNAME"
    value = module.environment.containers.web.generated_hostname
  }
}
