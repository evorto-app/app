# Discounts & Providers

## ESNcard integration intent
- ESNcard is an optional, tenant-scoped provider configured via `tenants.discountProviders.esnCard`.
- User cards live in `user_discount_cards` with validation status and validity window (`validTo`).
- Validation calls `https://esncard.org/services/1.0/card.json?code=...` on save/refresh only and persists expiry to `validTo`.
- Registration options store optional provider discounts in JSON (`discountedPrice`, `discountType`).
- Registration applies the lowest eligible price and stores a snapshot (`appliedDiscountType`, `appliedDiscountedPrice`, `discountAmount`) for scan-time visibility.

## Guardrails
- Keep ESNcard optional and fully hidden when disabled.
- Avoid building a generic discount engine; model only what is needed for ESNcard.
- New providers should follow the same tenant-gated, per-user-card pattern.
