# Research: Inclusive Tax Rates Feature

## Problem Restatement
Provide tenant-scoped inclusive tax rate management integrated with Stripe so that all paid registration prices are final (tax-inclusive) and correctly attributed to a Stripe tax rate ID during checkout without doing tax arithmetic in-app.

## Key Decisions
| Decision | Rationale | Alternatives | Status |
|----------|-----------|-------------|--------|
| Use Stripe tax rates directly (no internal tax calc) | Avoid complexity + compliance risk | Compute tax internally | Accepted |
| Import + cache only inclusive active rates for selection | Enforce policy; selection safety | Allow exclusive rates with runtime guard | Accepted |
| Unique index (tenantId, stripeTaxRateId) | Prevent duplicates; simplifies upsert | App-level check only | Accepted |
| Server validation for paid options requiring rate | Source of truth | Client-only enforcement | Accepted |
| Fallback label "Incl. Tax" when unresolved | Preserve UX continuity | Hard error | Accepted |
| Assign legacy paid options a default imported tax rate resolved from tenant.stripeReducedTaxRate | Preserves paid status & compliance | Coerce to free (loses revenue data) | Accepted |
| Treat discounted price <= 0 as free (no tax rate at checkout) | Payment provider semantics; avoid negative/zero charge complexity | Keep tax rate and label at 0 | Accepted |
| Show 0% as "Incl. 0% Tax" | Consistency with pattern | Special-case "Tax free" text | Accepted |
| Validation logs (warn) when referenced rate inactive at checkout | Traceability | Silent ignore | Accepted |
| Single SELECT for active list | Performance and simplicity | Join per option (N+1) | Accepted |
| Introduce `admin:manageTaxes` permission | Principle of least privilege; decouple tax management from broader settings | Reuse `admin:changeSettings` | Accepted |

## Data Points
- Stripe tax rates immutable: no need for background sync.
- Typical tenant tax rate count small (<50); simple indexed queries sufficient.
- Inclusive tax means unit_amount already final; pass tax_rates array only.

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Legacy paid options lack rate | Loss of compliance labeling / blocked edits | Assign default from tenant.stripeReducedTaxRate; log each assignment |
| Missing or invalid tenant.stripeReducedTaxRate | Legacy paid options remain without rate | Error log + admin warning; manual remediation required |
| Admin imports archived/exclusive by mistake | Incorrect creator usage | Disable selection + validate inclusive+active server-side |
| Rate removed at Stripe after selection | Checkout failure | Warn earlier; if Stripe rejects, surface error gracefully |
| Discount drives price negative | Payment error | Clamp at 0, treat as free |
| Cross-tenant leakage | Compliance breach | Always filter on tenantId at DB & schema level |

## Open Clarifications (Non-blocking)
- Confirm fallback behavior if tenant.stripeReducedTaxRate is missing or invalid (plan: log & skip; manual intervention required).

## Conclusion
Research complete; no blocking unknowns remain. Proceed to design (Phase 1).
