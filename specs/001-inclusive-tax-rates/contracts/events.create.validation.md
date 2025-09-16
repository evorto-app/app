# Contract: events.create (Tax Validation Aspect)

Same validation set as template registration options.

Per registration option:
- Paid requires compatible stripeTaxRateId
- Free forbids stripeTaxRateId

Errors:
- ERR_PAID_REQUIRES_TAX_RATE
- ERR_FREE_CANNOT_HAVE_TAX_RATE
- ERR_INCOMPATIBLE_TAX_RATE
