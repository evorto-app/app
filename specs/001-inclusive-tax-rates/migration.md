# Migration Plan: Inclusive Tax Rates

## Objectives
1. Add unique index ensuring one copy of each Stripe tax rate per tenant.
2. Import / ensure presence of default legacy tax rate derived from `tenant.stripeReducedTaxRate` for each tenant.
3. Assign that tax rate to legacy paid registration options lacking a `stripeTaxRateId`.
4. Seed example rates (dev/demo only) without affecting production.
5. Idempotent, safe re-run; comprehensive logging.

## Preconditions
- Drizzle schema already contains `tenant_stripe_tax_rates` table and nullable `stripeTaxRateId` columns on registration option tables.
- Each tenant row may have `stripeReducedTaxRate` (Stripe tax rate id) configured.

## Steps (Idempotent)
| # | Step | Details | Idempotency Strategy |
|---|------|---------|----------------------|
| 0 | Grant new permission | For each role with `admin:changeSettings`, if missing, insert role_permission(`admin:manageTaxes`) | Insert ignore / ON CONFLICT DO NOTHING |
| 1 | Add unique index | `CREATE UNIQUE INDEX IF NOT EXISTS tenant_stripe_tax_rates_tenant_rate_uidx ON tenant_stripe_tax_rates(tenantId, stripeTaxRateId);` | IF NOT EXISTS guard or catch duplicate error |
| 2 | Fetch tenants | Select tenantId, stripeReducedTaxRate FROM tenants WHERE stripeReducedTaxRate IS NOT NULL | Pure read |
| 3 | For each tenant: fetch Stripe tax rate | Stripe API retrieve tax rate id=tenant.stripeReducedTaxRate | Safe re-call (Stripe idempotent read) |
| 4 | Upsert tax rate row | Insert/update with snapshot fields (displayName, percentage, inclusive, active, country, state) | ON CONFLICT (tenantId,stripeTaxRateId) DO UPDATE |
| 5 | Assign to legacy paid template options | UPDATE template_registration_options SET stripeTaxRateId=defaultId WHERE tenantId=? AND isPaid=true AND stripeTaxRateId IS NULL | Repeat runs no change after first |
| 6 | Assign to legacy paid event options | Same pattern for event_registration_options | Repeat safe |
| 7 | Log assignments | Structured log per affected row: {tenantId, optionId, appliedStripeTaxRateId, migration:"inclusive-tax-rates"} | N/A (append-only) |
| 8 | Seed sample rates (dev only) | If NODE_ENV != 'production': import 0%,7%,19% (inclusive, active) if absent | Environment gate + upsert |
| 9 | Verification summary | Counts: total tenants processed; total tax rates upserted; options updated | Deterministic |

## Error Handling
| Scenario | Action |
|----------|--------|
| tenant.stripeReducedTaxRate invalid / Stripe 404 | Log ERROR {tenantId, rateId}; skip assignment for that tenant |
| Stripe API transient error | Retry w/ exponential backoff (max 3) then log ERROR |
| Unique index create race | Ignore duplicate error if appears due to IF NOT EXISTS absence on some engines |
| Assignment affects 0 rows | Log INFO (no legacy rows) |

## Rollback Strategy
- Index addition is additive (no rollback required).
- If incorrect assignments: run remediation UPDATE setting stripeTaxRateId=NULL and re-run migration after fixing configuration (rare).

## Verification Queries (Post Migration)
```
-- 0. New permission granted where expected
SELECT COUNT(*) FROM role_permissions rp JOIN role_permissions rp2 ON rp.role_id=rp2.role_id AND rp2.permission='admin:changeSettings' WHERE rp.permission='admin:manageTaxes';

-- 1. No paid option without tax rate
SELECT COUNT(*) FROM template_registration_options WHERE isPaid=true AND stripeTaxRateId IS NULL; -- expect 0
SELECT COUNT(*) FROM event_registration_options WHERE isPaid=true AND stripeTaxRateId IS NULL; -- expect 0

-- 2. Unique constraint effective
SELECT tenantId, stripeTaxRateId, COUNT(*) c FROM tenant_stripe_tax_rates GROUP BY 1,2 HAVING COUNT(*)>1; -- expect none

-- 3. Default rate presence per tenant
SELECT t.id, t.stripeReducedTaxRate, r.id FROM tenants t LEFT JOIN tenant_stripe_tax_rates r ON r.tenantId=t.id AND r.stripeTaxRateId=t.stripeReducedTaxRate WHERE t.stripeReducedTaxRate IS NOT NULL AND r.id IS NULL; -- expect 0 rows
```

## Logging Schema Examples
```
INFO migration.inclusiveTaxRates.assigned { tenantId, optionType:"template", optionId, stripeTaxRateId }
WARN migration.inclusiveTaxRates.missingDefault { tenantId, stripeReducedTaxRate }
ERROR migration.inclusiveTaxRates.stripeFetchFailed { tenantId, stripeReducedTaxRate, error }
```

## Script Location
Implement under `migration/steps/tax-rates-legacy.ts` executed by existing migrator after prior steps.

## Testing Strategy
1. Pre-migration snapshot with fixtures containing:
   - Tenant A: two paid template options without tax rate, stripeReducedTaxRate configured.
   - Tenant B: one paid option already with matching rate.
2. Run migration: assert A's options get rate, B unchanged.
3. Re-run migration: no additional updates (idempotent).
4. Simulate missing Stripe rate: expect ERROR log + options remain without tax rate (caught in post verification).

## Open Considerations
- Future support for multiple default tiers (reduced vs normal) would require additional tenant fields; out of scope now.

## Completion Criteria
- All paid options have stripeTaxRateId.
- Verification queries return expected counts.
- Logs contain summary metrics.
