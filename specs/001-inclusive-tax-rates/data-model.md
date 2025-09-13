# Data Model: Inclusive Tax Rates

## Entities

### tenant_stripe_tax_rates
Reused table (ensure unique index added).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| tenantId | uuid | FK tenant | 
| stripeTaxRateId | text | Provider ID; unique per (tenantId,stripeTaxRateId) |
| displayName | text | Provider display name snapshot |
| percentage | text | Display (e.g. "19") stored as string to avoid FP issues |
| inclusive | boolean | Must be true for compatibility |
| active | boolean | Stripe active flag snapshot |
| country | text | ISO country or null |
| state | text | Region/state code or null |
| createdAt | timestamp | Existing default |
| updatedAt | timestamp | Existing default |

Unique Index: `(tenantId, stripeTaxRateId)` NEW

### Registration Option (existing tables)
Add validation logic only; schema unchanged:
- template_registration_options.stripeTaxRateId (nullable text)
- event_registration_options.stripeTaxRateId (nullable text)

Rules:
- If isPaid=true → stripeTaxRateId REQUIRED and must reference inclusive=true AND active=true row for tenant.
- If isPaid=false → stripeTaxRateId MUST be null.

### Derived / View Models
- ActiveCompatibleTaxRate = imported where inclusive=true AND active=true
- CreatorSelectionList: SELECT subset ordered by displayName, stripeTaxRateId

## Relationships
- tenant 1 - N tenant_stripe_tax_rates
- tenant_stripe_tax_rates 1 - N registration_options (logical reference via stripeTaxRateId + tenantId)

## Validation Summary
| Context | Rule | Error Code |
|---------|------|------------|
| Template create/update | Paid option missing stripeTaxRateId | ERR_PAID_REQUIRES_TAX_RATE |
| Template create/update | Free option has stripeTaxRateId | ERR_FREE_CANNOT_HAVE_TAX_RATE |
| Template create/update | Rate not found/incompatible | ERR_INCOMPATIBLE_TAX_RATE |
| Event create | Same three rules | (same codes) |
| Checkout | If stored stripeTaxRateId exists but not compatible → still pass ID; warn | WARN_INACTIVE_TAX_RATE |

## Indices
- NEW: `CREATE UNIQUE INDEX tenant_stripe_tax_rates_tenant_rate_uidx ON tenant_stripe_tax_rates(tenantId, stripeTaxRateId);`

## Migration Impact
- Add unique index (idempotent) `(tenantId, stripeTaxRateId)`.
- Legacy paid options without tax rate: resolve `tenant.stripeReducedTaxRate` via Stripe; import (or ensure imported) its tax rate row; assign its `stripeTaxRateId` to all such paid options (preserving `isPaid=true`). Log each updated option (registrationOptionId, previousNullRate=true).
- If `tenant.stripeReducedTaxRate` missing/invalid: log ERROR and leave those options unchanged for manual remediation (report surfaced to admin warnings area).
- Seed insertion (idempotent upsert) of sample inclusive active rates (0,7,19) per tenant (development/demo only) — skipped when `NODE_ENV=production`.

## Non-Functional Notes
- Query path: single indexed predicate (tenantId + filters) < 200ms.
- No heavy joins; simple filter + order.
