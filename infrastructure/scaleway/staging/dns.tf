resource "scaleway_container_domain" "web" {
  container_id = module.environment.containers.web.id
  region       = var.region
  hostname     = "staging.evorto.app"
}
