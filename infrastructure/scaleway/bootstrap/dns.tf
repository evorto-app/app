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
