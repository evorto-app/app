output "backend_configuration" {
  description = "Non-secret backend values for each isolated Terraform root."
  value = {
    bootstrap = {
      bucket               = scaleway_object_bucket.terraform_state["bootstrap"].name
      key                  = "evorto/bootstrap.tfstate"
      state_application_id = scaleway_iam_application.bootstrap_terraform_state.id
    }
    production = var.enable_production ? {
      bucket               = scaleway_object_bucket.terraform_state["production"].name
      key                  = "evorto/production.tfstate"
      state_application_id = scaleway_iam_application.production_terraform_state[0].id
    } : null
    staging = {
      bucket               = scaleway_object_bucket.terraform_state["staging"].name
      key                  = "evorto/staging.tfstate"
      state_application_id = scaleway_iam_application.staging_terraform_state.id
    }
    region = var.region
    endpoints = {
      s3 = "https://s3.${var.region}.scw.cloud"
    }
  }
}

output "environments" {
  description = "Non-secret IDs copied into the matching protected GitHub environment variables."
  value = {
    staging = {
      deployer_application_id = scaleway_iam_application.staging_deployer.id
      project_id              = scaleway_account_project.staging.id
      registry_endpoint       = scaleway_registry_namespace.staging.endpoint
      web_application_id      = scaleway_iam_application.staging_web.id
      worker_application_id   = scaleway_iam_application.staging_worker.id
    }
    production = var.enable_production ? {
      deployer_application_id = scaleway_iam_application.production_deployer[0].id
      project_id              = scaleway_account_project.production[0].id
      registry_endpoint       = scaleway_registry_namespace.production[0].endpoint
      web_application_id      = scaleway_iam_application.production_web[0].id
      worker_application_id   = scaleway_iam_application.production_worker[0].id
    } : null
  }
}

output "transactional_email_dns_records" {
  description = "Transactional Email records to maintain in the authoritative DNS zone."
  value = {
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
      value = scaleway_tem_domain.notifications.spf_value
    }
  }
}
