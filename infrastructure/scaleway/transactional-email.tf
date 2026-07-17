resource "scaleway_tem_domain" "notifications" {
  project_id = var.tem_project_id
  region     = var.region
  name       = "notifications.evorto.app"
  accept_tos = true
  autoconfig = false
}

resource "scaleway_tem_domain_validation" "notifications" {
  count = var.validate_tem_dns ? 1 : 0

  domain_id = scaleway_tem_domain.notifications.id
  region    = var.region
  timeout   = 900
}
