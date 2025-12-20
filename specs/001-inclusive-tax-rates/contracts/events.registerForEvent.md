# Contract: events.registerForEvent (Checkout Tax Behavior)

Behavior Addendum:

- Determine effectivePrice after discounts (already inclusive) → line_items.unit_amount = effectivePrice.
- If option.stripeTaxRateId present, include: `line_items[].tax_rates = [stripeTaxRateId]`.
- If referenced tax rate no longer active/inclusive → still pass ID and log warning.
- If Stripe rejects missing/invalid tax rate ID → surface payment error to user.

No input schema change (existing selection of registration option).
