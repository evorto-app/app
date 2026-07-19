locals {
  role_secret_names = {
    web = toset([
      "CLIENT_ID",
      "CLIENT_SECRET",
      "COCKPIT_TRACES_TOKEN",
      "DATABASE_TLS_CA_CERTIFICATE",
      "DATABASE_URL",
      "ISSUER_BASE_URL",
      "PUBLIC_GOOGLE_MAPS_API_KEY",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "SECRET",
      "STRIPE_API_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ])
    worker = setunion(
      toset([
        "COCKPIT_TRACES_TOKEN",
        "DATABASE_TLS_CA_CERTIFICATE",
        "DATABASE_URL",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "STRIPE_API_KEY",
        "TEM_API_TOKEN",
      ]),
      var.environment == "staging" ? toset(["STAGING_EMAIL_ALLOWLIST"]) : toset([]),
    )
    ops = toset([
      "COCKPIT_TRACES_TOKEN",
      "DATABASE_TLS_CA_CERTIFICATE",
      "DATABASE_URL",
    ])
  }
  role_secrets = merge([
    for role, names in local.role_secret_names : {
      for name in names : "${role}/${name}" => {
        name = name
        role = role
      }
    }
  ]...)
}

resource "scaleway_secret" "role" {
  for_each = local.role_secrets

  project_id  = var.project_id
  region      = var.region
  name        = each.value.name
  path        = "/evorto/${var.environment}/${each.value.role}"
  description = "Deployment-synchronized ${var.environment} ${each.value.role} secret"
  protected   = true

  tags = ["evorto", var.environment, each.value.role, "deployment-owned-value"]
}
