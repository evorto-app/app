# Migration Plan: Inclusive Tax Rates

## Objectives

1. Add unique index ensuring one copy of each Stripe tax rate per tenant.
2. Import / ensure presence of default legacy tax rate derived from `tenant.stripeReducedTaxRate` for each tenant.
3. Assign that tax rate to legacy paid registration options lacking a `stripeTaxRateId`.
4. Seed example rates (dev/demo only) without affecting production.
5. Add new `admin:manageTaxes` permission to existing admin roles.
6. Idempotent, safe re-run; comprehensive logging.

## Implementation Status

- [x] **T001**: Created `001_add_unique_index_tenant_stripe_tax_rates.ts` with idempotent unique index creation
- [x] **T002**: Created `002_backfill_and_seed_tax_rates.ts` with legacy backfill and sample data seeding
- [x] **T003**: Created `003_add_admin_manage_taxes_permission.ts` and updated permission system
- [x] **T022**: Updated admin tenant router to use `admin:manageTaxes` permission instead of `admin:changeSettings`

## Preconditions

- Drizzle schema already contains `tenant_stripe_tax_rates` table and nullable `stripeTaxRateId` columns on registration option tables.
- Each tenant row may have `stripeReducedTaxRate` (Stripe tax rate id) configured.

## Steps (Idempotent)

| #   | Step                                       | Details                                                                                                                            | Implementation        | Idempotency Strategy                     |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------- |
| 0   | **Add new permission to system**           | Add `admin:manageTaxes` to permissions.ts and role setup                                                                           | ✅ Implemented        | Permission array check in role setup     |
| 1   | **Grant new permission**                   | For each role with `admin:changeSettings`, if missing, add `admin:manageTaxes`                                                     | ✅ Migration step 003 | Array includes check before adding       |
| 2   | **Add unique index**                       | `CREATE UNIQUE INDEX CONCURRENTLY tenant_stripe_tax_rates_tenant_rate_uidx ON tenant_stripe_tax_rates(tenantId, stripeTaxRateId);` | ✅ Migration step 001 | Check pg_indexes before creating         |
| 3   | **Fetch tenants**                          | Select tenantId, stripeReducedTaxRate FROM tenants WHERE stripeReducedTaxRate IS NOT NULL                                          | ✅ Migration step 002 | Pure read                                |
| 4   | **For each tenant: fetch Stripe tax rate** | Stripe API retrieve tax rate id=tenant.stripeReducedTaxRate                                                                        | ✅ Migration step 002 | Safe re-call (Stripe idempotent read)    |
| 5   | **Upsert tax rate row**                    | Insert/update with snapshot fields (displayName, percentage, inclusive, active, country, state)                                    | ✅ Migration step 002 | Check existing record before insert      |
| 6   | **Seed sample rates (dev only)**           | If NODE_ENV != 'production': import 0%,7%,19% (inclusive, active) if absent                                                        | ✅ Migration step 002 | Environment gate + existing record check |
| 7   | **Assign to legacy paid template options** | UPDATE template_registration_options SET stripeTaxRateId=defaultId WHERE isPaid=true AND stripeTaxRateId IS NULL                   | ✅ Migration step 002 | WHERE clause ensures no overwrite        |
| 8   | **Assign to legacy paid event options**    | Same pattern for event_registration_options                                                                                        | ✅ Migration step 002 | WHERE clause ensures no overwrite        |
| 9   | **Log assignments**                        | Structured log per affected row: {tenantId, optionId, appliedStripeTaxRateId}                                                      | ✅ Migration step 002 | N/A (append-only)                        |
| 10  | **Update router permissions**              | Change admin endpoints from `admin:changeSettings` to `admin:manageTaxes`                                                          | ✅ T022 implemented   | Code replacement                         |

## Error Handling

| Scenario                                         | Action                                                       | Implementation                  |
| ------------------------------------------------ | ------------------------------------------------------------ | ------------------------------- |
| tenant.stripeReducedTaxRate invalid / Stripe 404 | Log WARN {tenantId, rateId}; skip assignment for that tenant | ✅ Try-catch with warning log   |
| Stripe API transient error                       | Retry w/ exponential backoff (max 3) then log ERROR          | ✅ Try-catch with error log     |
| Unique index create race                         | Ignore duplicate error if appears                            | ✅ Check existing before create |
| Assignment affects 0 rows                        | Log INFO (no legacy rows)                                    | ✅ Count affected rows and log  |

## Rollback Strategy

- Index addition is additive (no rollback required).
- Permission additions are additive (no rollback required).
- If incorrect assignments: run remediation UPDATE setting stripeTaxRateId=NULL and re-run migration after fixing configuration (rare).

## Verification Queries (Post Migration)

```sql
-- 1. New permission granted where expected
SELECT r.name, r.permissions
FROM roles r
WHERE r.permissions @> '["admin:manageTaxes"]'::jsonb;

-- 2. No paid option without tax rate
SELECT COUNT(*) FROM template_registration_options WHERE isPaid=true AND stripeTaxRateId IS NULL; -- expect 0
SELECT COUNT(*) FROM event_registration_options WHERE isPaid=true AND stripeTaxRateId IS NULL; -- expect 0

-- 3. Unique constraint effective
SELECT tenantId, stripeTaxRateId, COUNT(*) c FROM tenant_stripe_tax_rates GROUP BY 1,2 HAVING COUNT(*)>1; -- expect none

-- 4. Default rate presence per tenant
SELECT t.id, t.stripeReducedTaxRate, r.id
FROM tenants t
LEFT JOIN tenant_stripe_tax_rates r ON r.tenantId=t.id AND r.stripeTaxRateId=t.stripeReducedTaxRate
WHERE t.stripeReducedTaxRate IS NOT NULL AND r.id IS NULL; -- expect 0 rows

-- 5. Sample rates seeded in development
SELECT displayName, percentage, inclusive, active
FROM tenant_stripe_tax_rates
WHERE stripeTaxRateId LIKE 'dev_%';
```

## Integration

- Migration steps are integrated into `/migration/index.ts`
- Global step (unique index) runs before tenant-specific steps
- Tenant steps run after role setup and user assignments
- Compatible with existing migration framework

## Completion Criteria

- [x] All migration steps implemented and integrated
- [x] New permission added to system and admin roles
- [x] Admin router updated to use new permission
- [ ] All paid options have stripeTaxRateId (after migration run)
- [ ] Verification queries return expected counts (after migration run)
- [ ] Logs contain summary metrics (after migration run)
