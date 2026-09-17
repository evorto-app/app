---
default: minor
---

Derive each tenant's secure public origin from its normalized primary domain,
and use that trusted origin for tenant-scoped email and Stripe return links
instead of request-controlled or process-global origins. Primary-domain
changes now wait for pending Stripe and registration-transfer links to finish,
and the platform UI warns that links and QR codes using the old address will
stop working.
