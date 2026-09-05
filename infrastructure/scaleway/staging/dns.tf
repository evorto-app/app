resource "cloudflare_dns_record" "web" {
  zone_id = var.cloudflare_zone_id
  name    = "staging.evorto.app"
  type    = "CNAME"
  content = module.environment.containers.web.generated_hostname
  ttl     = 300
  proxied = false
  comment = "Evorto staging on Scaleway; managed by Terraform"
}

resource "scaleway_container_domain" "web" {
  container_id = module.environment.containers.web.id
  region       = var.region
  hostname     = "staging.evorto.app"

  depends_on = [cloudflare_dns_record.web]
}
