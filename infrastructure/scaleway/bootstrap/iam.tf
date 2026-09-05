locals {
  environment_deployer_permission_sets = [
    "ContainerRegistryFullAccess",
    "ContainersFullAccess",
    "ContainersPrivateAccess",
    "IPAMReadOnly",
    "ObjectStorageFullAccess",
    "ObservabilityFullAccess",
    "PrivateNetworksFullAccess",
    "RelationalDatabasesFullAccess",
    "SecretManagerFullAccess",
    "VPCFullAccess",
  ]
  terraform_state_permission_sets = [
    "ObjectStorageBucketsRead",
    "ObjectStorageObjectsDelete",
    "ObjectStorageObjectsRead",
    "ObjectStorageObjectsWrite",
  ]
  runtime_object_storage_permission_sets = [
    "ObjectStorageBucketsRead",
    "ObjectStorageObjectsDelete",
    "ObjectStorageObjectsRead",
    "ObjectStorageObjectsWrite",
  ]
}

resource "scaleway_iam_application" "bootstrap_terraform_state" {
  organization_id = var.organization_id
  name            = "evorto-bootstrap-terraform-state"
  description     = "S3 identity for only the bootstrap Terraform state bucket; API keys are created outside Terraform state"
}

resource "scaleway_iam_application" "staging_terraform_state" {
  organization_id = var.organization_id
  name            = "evorto-staging-terraform-state"
  description     = "S3 identity for only the staging Terraform state bucket; API keys are created outside Terraform state"
}

resource "scaleway_iam_application" "production_terraform_state" {
  organization_id = var.organization_id
  name            = "evorto-production-terraform-state"
  description     = "S3 identity for only the production Terraform state bucket; API keys are created outside Terraform state"
}

resource "scaleway_iam_policy" "bootstrap_terraform_state" {
  name            = "evorto-bootstrap-terraform-state"
  description     = "Read and update only bucket-policy-authorized state in the bootstrap project"
  application_id  = scaleway_iam_application.bootstrap_terraform_state.id
  organization_id = var.organization_id

  rule {
    project_ids          = [var.bootstrap_project_id]
    permission_set_names = local.terraform_state_permission_sets
  }
}

resource "scaleway_iam_policy" "staging_terraform_state" {
  name            = "evorto-staging-terraform-state"
  description     = "Read and update only bucket-policy-authorized state in the staging project"
  application_id  = scaleway_iam_application.staging_terraform_state.id
  organization_id = var.organization_id

  rule {
    project_ids          = [scaleway_account_project.staging.id]
    permission_set_names = local.terraform_state_permission_sets
  }
}

resource "scaleway_iam_policy" "production_terraform_state" {
  name            = "evorto-production-terraform-state"
  description     = "Read and update only bucket-policy-authorized state in the production project"
  application_id  = scaleway_iam_application.production_terraform_state.id
  organization_id = var.organization_id

  rule {
    project_ids          = [scaleway_account_project.production.id]
    permission_set_names = local.terraform_state_permission_sets
  }
}

resource "scaleway_iam_application" "staging_deployer" {
  organization_id = var.organization_id
  name            = "evorto-staging-github-deployer"
  description     = "Protected staging deployment identity; API keys are created outside Terraform state"
}

resource "scaleway_iam_application" "production_deployer" {
  organization_id = var.organization_id
  name            = "evorto-production-github-deployer"
  description     = "Protected production deployment identity; API keys are created outside Terraform state"
}

resource "scaleway_iam_application" "staging_web" {
  organization_id = var.organization_id
  name            = "evorto-staging-web"
  description     = "S3 identity used only by the staging web role"
}

resource "scaleway_iam_application" "staging_worker" {
  organization_id = var.organization_id
  name            = "evorto-staging-worker"
  description     = "S3 and Transactional Email identity used only by the staging worker role"
}

resource "scaleway_iam_application" "production_web" {
  organization_id = var.organization_id
  name            = "evorto-production-web"
  description     = "S3 identity used only by the production web role"
}

resource "scaleway_iam_application" "production_worker" {
  organization_id = var.organization_id
  name            = "evorto-production-worker"
  description     = "S3 and Transactional Email identity used only by the production worker role"
}

resource "scaleway_iam_policy" "staging_deployer" {
  name            = "evorto-staging-deployer"
  description     = "Reconcile and deploy only the staging project"
  application_id  = scaleway_iam_application.staging_deployer.id
  organization_id = var.organization_id

  rule {
    project_ids          = [scaleway_account_project.staging.id]
    permission_set_names = local.environment_deployer_permission_sets
  }
}

resource "scaleway_iam_policy" "production_deployer" {
  name            = "evorto-production-deployer"
  description     = "Reconcile production and read only accepted staging release artifacts"
  application_id  = scaleway_iam_application.production_deployer.id
  organization_id = var.organization_id

  rule {
    project_ids          = [scaleway_account_project.production.id]
    permission_set_names = local.environment_deployer_permission_sets
  }

  rule {
    project_ids = [scaleway_account_project.staging.id]
    permission_set_names = [
      "ContainerRegistryReadOnly",
      "ObjectStorageBucketsRead",
      "ObjectStorageObjectsRead",
    ]
  }
}

resource "scaleway_iam_policy" "staging_web_storage" {
  name            = "evorto-staging-web-storage"
  description     = "Authorize the staging web role for bucket-policy-narrowed object access"
  application_id  = scaleway_iam_application.staging_web.id
  organization_id = var.organization_id

  rule {
    project_ids          = [scaleway_account_project.staging.id]
    permission_set_names = local.runtime_object_storage_permission_sets
  }
}

resource "scaleway_iam_policy" "staging_worker_storage" {
  name            = "evorto-staging-worker-storage"
  description     = "Authorize the staging worker role for bucket-policy-narrowed object access"
  application_id  = scaleway_iam_application.staging_worker.id
  organization_id = var.organization_id

  rule {
    project_ids          = [scaleway_account_project.staging.id]
    permission_set_names = local.runtime_object_storage_permission_sets
  }
}

resource "scaleway_iam_policy" "production_web_storage" {
  name            = "evorto-production-web-storage"
  description     = "Authorize the production web role for bucket-policy-narrowed object access"
  application_id  = scaleway_iam_application.production_web.id
  organization_id = var.organization_id

  rule {
    project_ids          = [scaleway_account_project.production.id]
    permission_set_names = local.runtime_object_storage_permission_sets
  }
}

resource "scaleway_iam_policy" "production_worker_storage" {
  name            = "evorto-production-worker-storage"
  description     = "Authorize the production worker role for bucket-policy-narrowed object access"
  application_id  = scaleway_iam_application.production_worker.id
  organization_id = var.organization_id

  rule {
    project_ids          = [scaleway_account_project.production.id]
    permission_set_names = local.runtime_object_storage_permission_sets
  }
}

resource "scaleway_iam_policy" "staging_worker_tem" {
  name            = "evorto-staging-worker-tem"
  description     = "Allow the staging worker to send through Transactional Email only"
  application_id  = scaleway_iam_application.staging_worker.id
  organization_id = var.organization_id

  rule {
    project_ids          = [var.tem_project_id]
    permission_set_names = ["TransactionalEmailEmailApiCreate"]
  }
}

resource "scaleway_iam_policy" "production_worker_tem" {
  name            = "evorto-production-worker-tem"
  description     = "Allow the production worker to send through Transactional Email only"
  application_id  = scaleway_iam_application.production_worker.id
  organization_id = var.organization_id

  rule {
    project_ids          = [var.tem_project_id]
    permission_set_names = ["TransactionalEmailEmailApiCreate"]
  }
}
