---
evorto: patch
---

# Align tax rates track behavior with specification

Align tax rate permissions, sync behavior, and registration persistence with the tax-rates conductor track.

Highlights:

- switch tax-rate admin access checks from `admin:manageTaxes` to `admin:tax` (with legacy compatibility mapping for existing roles),
- enforce server-side rejection of non-inclusive Stripe tax rates during import,
- persist selected registration tax-rate snapshot fields (`tax_rate_id`, name, percentage, inclusive/exclusive) on `event_registrations`,
- require tax-rate selection only when registration options are paid.
