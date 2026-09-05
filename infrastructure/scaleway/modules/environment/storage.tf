locals {
  application_bucket_name = "evorto-${var.environment}-application-${var.bucket_suffix}"
  metadata_bucket_name    = "evorto-${var.environment}-deployment-${var.bucket_suffix}"
}

resource "scaleway_object_bucket" "application" {
  project_id    = var.project_id
  region        = var.region
  name          = local.application_bucket_name
  force_destroy = false

  versioning {
    enabled = true
  }

  cors_rule {
    allowed_methods = ["POST", "GET", "HEAD"]
    allowed_origins = ["https://${var.hostname}"]
    allowed_headers = ["content-type", "x-amz-*", "x-amz-meta-*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }

  lifecycle_rule {
    id                                     = "abort-incomplete-uploads"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 1
  }

  lifecycle_rule {
    id      = "expire-temporary-receipt-uploads"
    enabled = true
    prefix  = "receipt-uploads/"

    expiration {
      days = 1
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  lifecycle_rule {
    id      = "expire-old-noncurrent-versions"
    enabled = true

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  tags = {
    application = "evorto"
    environment = var.environment
    managed_by  = "terraform"
    privacy     = "private"
  }
}

resource "scaleway_object_bucket_acl" "application" {
  project_id = var.project_id
  region     = var.region
  bucket     = scaleway_object_bucket.application.name
  acl        = "private"
}

resource "scaleway_object_bucket_server_side_encryption_configuration" "application" {
  project_id = var.project_id
  region     = var.region
  bucket     = scaleway_object_bucket.application.name

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "scaleway_object_bucket" "deployment_metadata" {
  project_id    = var.project_id
  region        = var.region
  name          = local.metadata_bucket_name
  force_destroy = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    id      = "expire-private-source-maps"
    enabled = true
    prefix  = "source-maps/"

    expiration {
      days = 90
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  tags = {
    application = "evorto"
    environment = var.environment
    managed_by  = "terraform"
    privacy     = "private"
  }
}

resource "scaleway_object_bucket_acl" "deployment_metadata" {
  project_id = var.project_id
  region     = var.region
  bucket     = scaleway_object_bucket.deployment_metadata.name
  acl        = "private"
}

resource "scaleway_object_bucket_server_side_encryption_configuration" "deployment_metadata" {
  project_id = var.project_id
  region     = var.region
  bucket     = scaleway_object_bucket.deployment_metadata.name

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "scaleway_object_bucket_policy" "deployment_metadata" {
  project_id = var.project_id
  region     = var.region
  bucket     = scaleway_object_bucket.deployment_metadata.name

  depends_on = [
    scaleway_object_bucket_acl.deployment_metadata,
    scaleway_object_bucket_server_side_encryption_configuration.deployment_metadata,
  ]

  policy = jsonencode({
    Version = "2023-04-17"
    Statement = concat(
      [
        {
          Sid    = "DeploymentManagementAccess"
          Effect = "Allow"
          Principal = {
            SCW = "application_id:${var.management_application_id}"
          }
          Action = "s3:*"
          Resource = [
            scaleway_object_bucket.deployment_metadata.name,
            "${scaleway_object_bucket.deployment_metadata.name}/*",
          ]
        },
      ],
      length(var.deployment_metadata_reader_application_ids) == 0 ? [] : [
        {
          Sid    = "PromotionReadAccess"
          Effect = "Allow"
          Principal = {
            SCW = [
              for application_id in var.deployment_metadata_reader_application_ids :
              "application_id:${application_id}"
            ]
          }
          Action = [
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
          ]
          Resource = [
            scaleway_object_bucket.deployment_metadata.name,
            "${scaleway_object_bucket.deployment_metadata.name}/*",
          ]
        },
      ],
    )
  })
}

resource "scaleway_object_bucket_policy" "application" {
  project_id = var.project_id
  region     = var.region
  bucket     = scaleway_object_bucket.application.name

  depends_on = [
    scaleway_object_bucket_acl.application,
    scaleway_object_bucket_server_side_encryption_configuration.application,
  ]

  policy = jsonencode({
    Version = "2023-04-17"
    Statement = [
      {
        Sid    = "DeploymentManagementAccess"
        Effect = "Allow"
        Principal = {
          SCW = "application_id:${var.management_application_id}"
        }
        Action = "s3:*"
        Resource = [
          scaleway_object_bucket.application.name,
          "${scaleway_object_bucket.application.name}/*",
        ]
      },
      {
        Sid    = "RoleObjectAccess"
        Effect = "Allow"
        Principal = {
          SCW = [
            "application_id:${var.web_application_id}",
            "application_id:${var.worker_application_id}",
          ]
        }
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [
          "${scaleway_object_bucket.application.name}/*",
        ]
      },
      {
        Sid    = "RoleBucketMetadataAccess"
        Effect = "Allow"
        Principal = {
          SCW = [
            "application_id:${var.web_application_id}",
            "application_id:${var.worker_application_id}",
          ]
        }
        Action   = ["s3:GetBucketLocation", "s3:ListBucket"]
        Resource = [scaleway_object_bucket.application.name]
      },
    ]
  })
}
