resource "scaleway_account_project" "staging" {
  organization_id = var.organization_id
  name            = "evorto-staging"
  description     = "Public staging with seeded and test data only"

  lifecycle {
    prevent_destroy = true
  }
}

resource "scaleway_account_project" "production" {
  organization_id = var.organization_id
  name            = "evorto-production"
  description     = "Production application resources"

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  terraform_state_backends = {
    bootstrap = {
      application_id = scaleway_iam_application.bootstrap_terraform_state.id
      bucket_name    = var.state_bucket_names.bootstrap
      project_id     = var.bootstrap_project_id
    }
    production = {
      application_id = scaleway_iam_application.production_terraform_state.id
      bucket_name    = var.state_bucket_names.production
      project_id     = scaleway_account_project.production.id
    }
    staging = {
      application_id = scaleway_iam_application.staging_terraform_state.id
      bucket_name    = var.state_bucket_names.staging
      project_id     = scaleway_account_project.staging.id
    }
  }
}

resource "scaleway_object_bucket" "terraform_state" {
  for_each = local.terraform_state_backends

  project_id    = each.value.project_id
  region        = var.region
  name          = each.value.bucket_name
  force_destroy = false

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "scaleway_object_bucket_acl" "terraform_state" {
  for_each = local.terraform_state_backends

  project_id = each.value.project_id
  region     = var.region
  bucket     = scaleway_object_bucket.terraform_state[each.key].name
  acl        = "private"
}

resource "scaleway_object_bucket_server_side_encryption_configuration" "terraform_state" {
  for_each = local.terraform_state_backends

  project_id = each.value.project_id
  region     = var.region
  bucket     = scaleway_object_bucket.terraform_state[each.key].name

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "scaleway_object_bucket_policy" "terraform_state" {
  for_each = local.terraform_state_backends

  project_id = each.value.project_id
  region     = var.region
  bucket     = scaleway_object_bucket.terraform_state[each.key].name

  depends_on = [
    scaleway_object_bucket_acl.terraform_state,
    scaleway_object_bucket_server_side_encryption_configuration.terraform_state,
  ]

  policy = jsonencode({
    Version = "2023-04-17"
    Statement = [
      {
        Sid    = "TerraformStateAccess"
        Effect = "Allow"
        Principal = {
          SCW = "application_id:${each.value.application_id}"
        }
        Action = [
          "s3:DeleteObject",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:PutObject",
        ]
        Resource = [
          scaleway_object_bucket.terraform_state[each.key].name,
          "${scaleway_object_bucket.terraform_state[each.key].name}/*",
        ]
      },
    ]
  })
}

resource "scaleway_registry_namespace" "staging" {
  project_id  = scaleway_account_project.staging.id
  region      = var.region
  name        = "evorto-staging"
  description = "Immutable Evorto staging application images"
  is_public   = false
}

resource "scaleway_registry_namespace" "production" {
  project_id  = scaleway_account_project.production.id
  region      = var.region
  name        = "evorto-production"
  description = "Immutable Evorto production application images"
  is_public   = false
}

resource "scaleway_billing_budget" "organization" {
  count = var.monthly_budget_eur == null ? 0 : 1

  organization_id   = var.organization_id
  consumption_limit = var.monthly_budget_eur
  enabled           = true
}
