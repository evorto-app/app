locals {
  tem_mx_parts = regex("^([0-9]+)\\s+(.+)$", scaleway_tem_domain.notifications.mx_config)
  tem_dns_records = {
    dkim = {
      content  = scaleway_tem_domain.notifications.dkim_config
      name     = trimsuffix(scaleway_tem_domain.notifications.dkim_name, ".")
      priority = null
      type     = "TXT"
    }
    dmarc = {
      content  = scaleway_tem_domain.notifications.dmarc_config
      name     = trimsuffix(scaleway_tem_domain.notifications.dmarc_name, ".")
      priority = null
      type     = "TXT"
    }
    mx = {
      content  = trimsuffix(local.tem_mx_parts[1], ".")
      name     = "notifications.evorto.app"
      priority = tonumber(local.tem_mx_parts[0])
      type     = "MX"
    }
    spf = {
      content  = scaleway_tem_domain.notifications.spf_value
      name     = "notifications.evorto.app"
      priority = null
      type     = "TXT"
    }
  }
}

moved {
  from = module.staging.scaleway_container_domain.web
  to   = scaleway_container_domain.staging_web
}

moved {
  from = module.production[0].scaleway_container_domain.web
  to   = scaleway_container_domain.production_web[0]
}

resource "cloudflare_dns_record" "staging" {
  zone_id = var.cloudflare_zone_id
  name    = "staging.evorto.app"
  type    = "CNAME"
  content = module.staging.containers.web.generated_hostname
  ttl     = 300
  proxied = false
  comment = "Evorto staging on Scaleway; managed by Terraform"
}

resource "scaleway_container_domain" "staging_web" {
  container_id = module.staging.containers.web.id
  region       = var.region
  hostname     = "staging.evorto.app"

  depends_on = [cloudflare_dns_record.staging]
}

resource "cloudflare_dns_record" "production" {
  count = var.production_enabled ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = "alpha.evorto.app"
  type    = "CNAME"
  content = module.production[0].containers.web.generated_hostname
  ttl     = 300
  proxied = false
  comment = "Evorto production on Scaleway; managed by Terraform"
}

resource "scaleway_container_domain" "production_web" {
  count = var.production_enabled ? 1 : 0

  container_id = module.production[0].containers.web.id
  region       = var.region
  hostname     = "alpha.evorto.app"

  depends_on = [cloudflare_dns_record.production]
}

resource "cloudflare_dns_record" "transactional_email" {
  for_each = local.tem_dns_records

  zone_id  = var.cloudflare_zone_id
  name     = each.value.name
  type     = each.value.type
  content  = each.value.content
  priority = each.value.priority
  ttl      = 300
  proxied  = false
  comment  = "Evorto Transactional Email on Scaleway; managed by Terraform"
}
