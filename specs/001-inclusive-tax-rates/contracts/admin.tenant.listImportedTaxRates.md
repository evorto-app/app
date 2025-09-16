# Contract: admin.tenant.listImportedTaxRates

Purpose: List imported tax rates for tenant admin visibility.

Input Schema:
```
{}
```
Permissions: `admin:manageTaxes`

Output Schema (array):
```
[
  {
    id: string, // internal UUID
    stripeTaxRateId: string,
    displayName: string,
    percentage: string,
    inclusive: boolean,
    active: boolean,
    country: string | null,
    state: string | null
  }, ...
]
```

Errors:
- NOT_AUTHORIZED
