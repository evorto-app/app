locals {
  # Scaleway canonicalizes the 1 GB container tier to this exact byte value.
  container_memory_limit_bytes = 1073000000
  common_environment_variables = {
    APP_BOOTSTRAP                    = "true"
    APP_ENVIRONMENT                  = var.environment
    APP_IMAGE_DIGEST                 = "deployment-required"
    APP_REVISION                     = "deployment-required"
    COCKPIT_TRACES_ENDPOINT          = scaleway_cockpit_source.traces.push_url
    DATABASE_POOL_CONNECT_TIMEOUT_MS = "10000"
    DATABASE_POOL_IDLE_TIMEOUT_MS    = "30000"
    DATABASE_POOL_MAX                = "5"
    DATABASE_POOL_MIN                = "0"
    DATABASE_TLS_REQUIRED            = "true"
    NODE_ENV                         = "production"
    SERVER_LOG_LEVEL                 = "info"
  }
  object_storage_environment_variables = {
    S3_BUCKET   = scaleway_object_bucket.application.name
    S3_ENDPOINT = "https://s3.${var.region}.scw.cloud"
    S3_REGION   = var.region
  }
  web_environment_variables = merge(local.common_environment_variables, local.object_storage_environment_variables, {
    APP_ROLE              = "web"
    BASE_URL              = "https://${var.hostname}"
    READINESS_TENANT_HOST = var.hostname
    TRUST_PLATFORM_PROXY  = "true"
    WORKER_TRIGGER_MODE   = "http"
  })
  worker_environment_variables = merge(local.common_environment_variables, local.object_storage_environment_variables, {
    APP_ROLE                = "worker"
    EMAIL_DELIVERY_PROVIDER = "tem"
    TEM_PROJECT_ID          = var.tem_project_id
    WORKER_TRIGGER_MODE     = "http"
  })
  ops_environment_variables = merge(local.common_environment_variables, {
    APP_ROLE              = "ops"
    APP_SCHEMA_HASH       = "deployment-required"
    DATABASE_RUNTIME_ROLE = "application_runtime"
    WORKER_TRIGGER_MODE   = "http"
  })
}

resource "scaleway_container_namespace" "application" {
  project_id  = var.project_id
  region      = var.region
  name        = "evorto-${var.environment}"
  description = "Evorto ${var.environment} web, worker, and ops roles"

  tags = ["evorto", var.environment, "terraform"]
}

resource "scaleway_registry_namespace" "application" {
  project_id  = var.project_id
  region      = var.region
  name        = "evorto-${var.environment}"
  description = "Immutable Evorto ${var.environment} application images"
  is_public   = false
}

resource "scaleway_container" "web" {
  namespace_id           = scaleway_container_namespace.application.id
  region                 = var.region
  name                   = "evorto-${var.environment}-web"
  description            = "Public HTTP, RPC, and SSR role"
  image                  = var.container_image
  port                   = 4200
  protocol               = "http1"
  privacy                = "public"
  https_connections_only = true
  sandbox                = "v2"
  cpu_limit              = 560
  memory_limit_bytes     = local.container_memory_limit_bytes
  min_scale              = var.web_min_scale
  max_scale              = 3
  timeout                = 300
  private_network_id     = scaleway_vpc_private_network.application.id

  environment_variables        = local.web_environment_variables
  secret_environment_variables = {}

  startup_probe {
    failure_threshold = 30
    interval          = "5s"
    timeout           = "1s"
    http {
      path = "/readyz"
    }
  }

  liveness_probe {
    failure_threshold = 3
    interval          = "10s"
    timeout           = "2s"
    http {
      path = "/healthz"
    }
  }

  scaling_option {
    concurrent_requests_threshold = 40
  }

  tags = ["evorto", var.environment, "web", "terraform"]

  lifecycle {
    ignore_changes = [
      image,
      environment_variables,
      secret_environment_variables,
    ]
  }
}

resource "scaleway_container" "worker" {
  namespace_id           = scaleway_container_namespace.application.id
  region                 = var.region
  name                   = "evorto-${var.environment}-worker"
  description            = "Private bounded background-operation endpoints"
  image                  = var.container_image
  port                   = 4200
  protocol               = "http1"
  privacy                = "private"
  https_connections_only = true
  sandbox                = "v2"
  cpu_limit              = 560
  memory_limit_bytes     = local.container_memory_limit_bytes
  min_scale              = 0
  max_scale              = 1
  timeout                = 300
  private_network_id     = scaleway_vpc_private_network.application.id

  environment_variables        = local.worker_environment_variables
  secret_environment_variables = {}

  startup_probe {
    failure_threshold = 30
    interval          = "5s"
    timeout           = "1s"
    http {
      path = "/healthz"
    }
  }

  liveness_probe {
    failure_threshold = 3
    interval          = "10s"
    timeout           = "2s"
    http {
      path = "/healthz"
    }
  }

  tags = ["evorto", var.environment, "worker", "terraform", "private"]

  lifecycle {
    ignore_changes = [
      image,
      environment_variables,
      secret_environment_variables,
    ]
  }
}

resource "scaleway_container" "ops" {
  namespace_id           = scaleway_container_namespace.application.id
  region                 = var.region
  name                   = "evorto-${var.environment}-ops"
  description            = "Private schema explain, apply, and staging seed endpoints"
  image                  = var.container_image
  port                   = 4200
  protocol               = "http1"
  privacy                = "private"
  https_connections_only = true
  sandbox                = "v2"
  cpu_limit              = 560
  memory_limit_bytes     = local.container_memory_limit_bytes
  min_scale              = 0
  max_scale              = 1
  timeout                = 300
  private_network_id     = scaleway_vpc_private_network.application.id

  environment_variables        = local.ops_environment_variables
  secret_environment_variables = {}

  startup_probe {
    failure_threshold = 30
    interval          = "5s"
    timeout           = "1s"
    http {
      path = "/healthz"
    }
  }

  liveness_probe {
    failure_threshold = 3
    interval          = "10s"
    timeout           = "2s"
    http {
      path = "/healthz"
    }
  }

  tags = ["evorto", var.environment, "ops", "terraform", "private"]

  lifecycle {
    ignore_changes = [
      image,
      environment_variables,
      secret_environment_variables,
    ]
  }
}

locals {
  worker_triggers = {
    email-delivery = {
      body     = { limit = 25 }
      path     = "/internal/worker/email-delivery"
      schedule = "* * * * *"
    }
    expired-checkout-cleanup = {
      body     = { limit = 50 }
      path     = "/internal/worker/expired-checkout-cleanup"
      schedule = "*/5 * * * *"
    }
    receipt-orphan-cleanup = {
      body     = { limit = 50 }
      path     = "/internal/worker/receipt-orphan-cleanup"
      schedule = "15 * * * *"
    }
    stripe-refunds = {
      body     = { limit = 25 }
      path     = "/internal/worker/stripe-refunds"
      schedule = "*/2 * * * *"
    }
  }
}

resource "scaleway_container_trigger" "worker" {
  for_each = local.worker_triggers

  container_id = scaleway_container.worker.id
  region       = var.region
  name         = "evorto-${var.environment}-${each.key}"
  description  = "Bounded ${each.key} invocation"

  destination_config {
    http_method = "post"
    http_path   = each.value.path
  }

  cron {
    schedule = each.value.schedule
    timezone = "Europe/Paris"
    body     = jsonencode(each.value.body)
    headers = {
      Content-Type = "application/json"
    }
  }

  tags = ["evorto", var.environment, "worker", "terraform"]
}
