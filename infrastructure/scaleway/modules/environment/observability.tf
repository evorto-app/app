resource "scaleway_cockpit_source" "traces" {
  project_id     = var.project_id
  region         = var.region
  name           = "evorto-${var.environment}-traces"
  type           = "traces"
  retention_days = var.cockpit_trace_retention_days
}

resource "scaleway_cockpit_source" "logs" {
  project_id     = var.project_id
  region         = var.region
  name           = "evorto-${var.environment}-logs"
  type           = "logs"
  retention_days = var.cockpit_log_retention_days
}

resource "scaleway_cockpit_source" "metrics" {
  project_id     = var.project_id
  region         = var.region
  name           = "evorto-${var.environment}-metrics"
  type           = "metrics"
  retention_days = var.cockpit_metric_retention_days
}

data "scaleway_cockpit_preconfigured_alert" "available" {
  project_id = var.project_id
  region     = var.region
}

resource "scaleway_cockpit_alert_manager" "application" {
  project_id              = var.project_id
  region                  = var.region
  preconfigured_alert_ids = toset(data.scaleway_cockpit_preconfigured_alert.available.alerts[*].preconfigured_rule_id)

  contact_points {
    email = var.alert_email
  }
}
