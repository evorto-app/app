# Contract: events.pricing.selection (Registration Pricing Application)

- Context: Applied during `events.registerForEvent`
- Inputs: `{ eventId, registrationOptionId }`
- Behavior:
  - Collect verified user credentials for tenant.
  - Filter by tenant‑enabled providers and validity on event start (`validTo == null || validTo >= eventStart`).
  - Fetch discounts from `event_registration_options.discounts` JSON:
    - Shape per item: `{ discountType: 'esnCard', discountedPrice: number }`
    - Pick lowest discounted price meeting eligibility.
  - Tie‑breakers: if equal to base price → use base; else alphabetical by provider type.
  - If effective price <= 0 → treat as free (PENDING→CONFIRMED, adjust spots like free registration).
  - Persist snapshot on `event_registrations`: `basePriceAtRegistration`, `appliedDiscountType`, `appliedDiscountedPrice`, `discountAmount`.
- Errors: capacity conflicts (existing behavior), not found, etc.
