resource "scaleway_vpc" "application" {
  project_id     = var.project_id
  region         = var.region
  name           = "evorto-${var.environment}"
  enable_routing = true

  tags = ["evorto", var.environment, "terraform"]
}

resource "scaleway_vpc_private_network" "application" {
  project_id = var.project_id
  region     = var.region
  vpc_id     = scaleway_vpc.application.id
  name       = "evorto-${var.environment}-private"
  tags       = ["evorto", var.environment, "terraform"]
}

resource "scaleway_rdb_instance" "application" {
  project_id    = var.project_id
  region        = var.region
  name          = "evorto-${var.environment}"
  node_type     = var.database_node_type
  engine        = "PostgreSQL-17"
  is_ha_cluster = var.database_is_ha

  user_name           = "schema_owner"
  password_wo         = var.schema_database_password
  password_wo_version = 1

  disable_backup            = false
  backup_same_region        = true
  backup_schedule_frequency = 24
  backup_schedule_retention = var.database_backup_retention_days
  encryption_at_rest        = true
  volume_type               = "sbs_5k"
  volume_size_in_gb         = var.database_volume_size_gb

  private_network {
    pn_id       = scaleway_vpc_private_network.application.id
    enable_ipam = true
  }

  tags = ["evorto", var.environment, "terraform", "private-only"]
}

resource "scaleway_rdb_database" "application" {
  instance_id = scaleway_rdb_instance.application.id
  region      = var.region
  name        = "evorto"
}

resource "scaleway_rdb_user" "runtime" {
  instance_id         = scaleway_rdb_instance.application.id
  region              = var.region
  name                = "application_runtime"
  is_admin            = false
  password_wo         = var.runtime_database_password
  password_wo_version = 1
}

resource "scaleway_rdb_privilege" "runtime" {
  instance_id   = scaleway_rdb_instance.application.id
  region        = var.region
  database_name = scaleway_rdb_database.application.name
  user_name     = scaleway_rdb_user.runtime.name
  permission    = "readwrite"
}
