resource "scaleway_account_project" "staging" {
  organization_id = var.organization_id
  name            = "evorto-staging"
  description     = "Public staging with seeded and test data only"
}

resource "scaleway_account_project" "production" {
  count = var.production_enabled ? 1 : 0

  organization_id = var.organization_id
  name            = "evorto-production"
  description     = "Production resources gated behind production_enabled"
}

module "staging" {
  source = "./modules/environment"

  environment                    = "staging"
  project_id                     = scaleway_account_project.staging.id
  tem_project_id                 = var.tem_project_id
  region                         = var.region
  zone                           = var.zone
  hostname                       = "staging.evorto.app"
  bucket_suffix                  = var.bucket_suffix
  container_image                = var.staging_container_image
  schema_database_password       = var.staging_schema_database_password
  runtime_database_password      = var.staging_runtime_database_password
  database_node_type             = "DB-DEV-S"
  database_is_ha                 = false
  database_backup_retention_days = 7
  database_volume_size_gb        = 10
  web_min_scale                  = 0
  alert_email                    = var.alert_email
}

module "production" {
  count  = var.production_enabled ? 1 : 0
  source = "./modules/environment"

  environment                    = "production"
  project_id                     = scaleway_account_project.production[0].id
  tem_project_id                 = var.tem_project_id
  region                         = var.region
  zone                           = var.zone
  hostname                       = "alpha.evorto.app"
  bucket_suffix                  = var.bucket_suffix
  container_image                = coalesce(var.production_container_image, var.staging_container_image)
  schema_database_password       = coalesce(var.production_schema_database_password, "production-disabled")
  runtime_database_password      = coalesce(var.production_runtime_database_password, "production-disabled")
  database_node_type             = "DB-POP2-2C-8G"
  database_is_ha                 = true
  database_backup_retention_days = 30
  database_volume_size_gb        = 50
  web_min_scale                  = 1
  alert_email                    = var.alert_email
}

resource "scaleway_iam_application" "deployer" {
  organization_id = var.organization_id
  name            = "evorto-github-deployer"
  description     = "Protected-environment deployment and reconciliation identity; API keys are created outside Terraform state"
}

resource "scaleway_iam_policy" "deployer_organization" {
  name            = "evorto-deployer-organization"
  description     = "Manage the dedicated Evorto projects, IAM principals, and billing budget"
  application_id  = scaleway_iam_application.deployer.id
  organization_id = var.organization_id

  rule {
    organization_id      = var.organization_id
    permission_set_names = ["IAMManager", "BillingManager"]
  }
}

resource "scaleway_iam_policy" "deployer_staging" {
  name           = "evorto-deployer-staging"
  description    = "Reconcile and deploy the staging project"
  application_id = scaleway_iam_application.deployer.id

  rule {
    project_ids = [scaleway_account_project.staging.id]
    permission_set_names = [
      "ContainerRegistryFullAccess",
      "ContainersFullAccess",
      "ContainersPrivateAccess",
      "ObjectStorageFullAccess",
      "ObservabilityFullAccess",
      "PrivateNetworksFullAccess",
      "RelationalDatabasesFullAccess",
      "SecretManagerFullAccess",
      "VPCFullAccess",
    ]
  }
}

resource "scaleway_iam_policy" "deployer_production" {
  count = var.production_enabled ? 1 : 0

  name           = "evorto-deployer-production"
  description    = "Reconcile and deploy the explicitly enabled production project"
  application_id = scaleway_iam_application.deployer.id

  rule {
    project_ids = [scaleway_account_project.production[0].id]
    permission_set_names = [
      "ContainerRegistryFullAccess",
      "ContainersFullAccess",
      "ContainersPrivateAccess",
      "ObjectStorageFullAccess",
      "ObservabilityFullAccess",
      "PrivateNetworksFullAccess",
      "RelationalDatabasesFullAccess",
      "SecretManagerFullAccess",
      "VPCFullAccess",
    ]
  }
}

resource "scaleway_iam_policy" "deployer_tem" {
  name           = "evorto-deployer-tem"
  description    = "Manage only Transactional Email resources in the shared email project"
  application_id = scaleway_iam_application.deployer.id

  rule {
    project_ids          = [var.tem_project_id]
    permission_set_names = ["TransactionalEmailDomainFullAccess"]
  }
}

resource "scaleway_billing_budget" "organization" {
  count = var.monthly_budget_eur == null ? 0 : 1

  organization_id   = var.organization_id
  consumption_limit = var.monthly_budget_eur
  enabled           = true
}
