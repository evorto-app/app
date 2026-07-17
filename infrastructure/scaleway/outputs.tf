output "staging" {
  value = {
    application_bucket         = module.staging.application_bucket
    cockpit                    = module.staging.cockpit
    containers                 = module.staging.containers
    deployment_metadata_bucket = module.staging.deployment_metadata_bucket
    project_id                 = scaleway_account_project.staging.id
    registry_endpoint          = module.staging.registry_endpoint
    role_application_ids       = module.staging.role_application_ids
    role_secret_ids            = module.staging.role_secret_ids
  }
}

output "staging_database" {
  value     = module.staging.database
  sensitive = true
}

output "production" {
  value = var.production_enabled ? {
    application_bucket         = module.production[0].application_bucket
    cockpit                    = module.production[0].cockpit
    containers                 = module.production[0].containers
    deployment_metadata_bucket = module.production[0].deployment_metadata_bucket
    project_id                 = scaleway_account_project.production[0].id
    registry_endpoint          = module.production[0].registry_endpoint
    role_application_ids       = module.production[0].role_application_ids
    role_secret_ids            = module.production[0].role_secret_ids
  } : null
}

output "production_database" {
  value     = var.production_enabled ? module.production[0].database : null
  sensitive = true
}

output "deployer_application_id" {
  description = "Create and rotate this application's API key outside Terraform state."
  value       = scaleway_iam_application.deployer.id
}

output "external_dns_records" {
  description = "Records to add at the existing authoritative DNS provider. Terraform intentionally does not manage that provider."
  value = {
    staging_cname = {
      name  = "staging.evorto.app"
      type  = "CNAME"
      value = module.staging.containers.web.generated_hostname
    }
    production_cname = var.production_enabled ? {
      name  = "alpha.evorto.app"
      type  = "CNAME"
      value = module.production[0].containers.web.generated_hostname
    } : null
    transactional_email = {
      dkim = {
        name  = scaleway_tem_domain.notifications.dkim_name
        type  = "TXT"
        value = scaleway_tem_domain.notifications.dkim_config
      }
      dmarc = {
        name  = scaleway_tem_domain.notifications.dmarc_name
        type  = "TXT"
        value = scaleway_tem_domain.notifications.dmarc_config
      }
      mx = {
        name  = "notifications.evorto.app"
        type  = "MX"
        value = scaleway_tem_domain.notifications.mx_config
      }
      spf = {
        name  = "notifications.evorto.app"
        type  = "TXT"
        value = scaleway_tem_domain.notifications.spf_config
      }
    }
  }
}
