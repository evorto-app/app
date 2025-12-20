# Contract: admin.tenant.listStripeTaxRates

Purpose: List provider (Stripe) tax rates for the tenant's connected Stripe account for admin import UI.

Input Schema:

```
{}
```

(Auth via session; requires permission `admin:manageTaxes`)

Output Schema (array):

```
[
  {
    id: string (stripeTaxRateId),
    displayName: string,
    percentage: string, // no % sign
    inclusive: boolean,
    active: boolean,
    country: string | null,
    state: string | null
  }, ...
]
```

Errors:

- NOT_AUTHORIZED (missing permission or missing tenant stripe account)
- PROVIDER_ERROR (Stripe API failure)
