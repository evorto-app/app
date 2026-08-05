module "environment" {
  source = "../modules/environment"

  environment               = "staging"
  project_id                = var.project_id
  management_application_id = var.deployer_application_id
  web_application_id        = var.web_application_id
  worker_application_id     = var.worker_application_id
  deployment_metadata_reader_application_ids = toset([
    var.production_deployer_application_id,
  ])
  tem_project_id                    = var.tem_project_id
  region                            = var.region
  zone                              = var.zone
  hostname                          = "staging.evorto.app"
  bucket_suffix                     = var.bucket_suffix
  container_image                   = var.container_image
  schema_database_password          = var.schema_database_password
  schema_database_password_version  = var.schema_database_password_version
  runtime_database_password         = var.runtime_database_password
  runtime_database_password_version = var.runtime_database_password_version
  database_node_type                = "DB-DEV-S"
  database_is_ha                    = false
  database_backup_retention_days    = 7
  database_volume_size_gb           = 10
  web_min_scale                     = 0
  alert_email                       = var.alert_email
}
