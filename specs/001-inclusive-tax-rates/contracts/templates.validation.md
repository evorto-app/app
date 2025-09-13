# Contract: templates.createSimpleTemplate / templates.updateSimpleTemplate (Tax Validation Aspect)

Augments existing procedures.

Validation Rules per registration option:
1. If isPaid = true → stripeTaxRateId MUST be non-null and reference inclusive=true AND active=true tax rate for tenant.
2. If isPaid = false → stripeTaxRateId MUST be null.
3. Incompatible or cross-tenant tax rate → error.

Input Delta (per registration option object):
```
{
  price: number, // smallest currency unit
  isPaid: boolean,
  stripeTaxRateId: string | null
}
```

Errors:
- ERR_PAID_REQUIRES_TAX_RATE
- ERR_FREE_CANNOT_HAVE_TAX_RATE
- ERR_INCOMPATIBLE_TAX_RATE
