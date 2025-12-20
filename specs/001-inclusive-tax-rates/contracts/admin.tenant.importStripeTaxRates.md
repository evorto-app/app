# Contract: admin.tenant.importStripeTaxRates

Purpose: Import selected Stripe tax rates into tenant_stripe_tax_rates.

Input Schema:

```
{
  stripeTaxRateIds: string[] // 1..50
}
```

Permissions: `admin:manageTaxes`

Validation:

- Each id non-empty
- Deduplicate array

Output Schema:

```
{
  imported: number,
  skipped: number, // already present
  incompatible: string[] // attempted but not inclusive+active (rejected)
}
```

Processing:

- Fetch each rate from Stripe (batch if possible)
- Accept only inclusive && active; others -> incompatible list
- Upsert (tenantId, stripeTaxRateId)

Errors:

- NOT_AUTHORIZED
- PROVIDER_ERROR
