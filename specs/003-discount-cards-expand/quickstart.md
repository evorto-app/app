# Quickstart: Tenant‑wide Discount Enablement

This quickstart walks through admin toggling, user ESNcard management, and discounted registration.

## Steps
1. As tenant admin, open Settings → Discounts and enable ESN Card.
2. As a user, go to Profile → Discount Cards, add your ESN card number, and verify.
   - If ESN is enabled and you have no verified card, you will see an explanation and a “Get your ESNcard” link.
3. Create an event template with a paid registration option (e.g., base €10) and add an ESN Card discounted price (€5).
4. Create an event from the template; the discount definition is duplicated to the event option.
5. Register as the user with a verified ESN card:
   - The lowest eligible price is applied.
   - If discounted price is €0, the registration is confirmed immediately (no payment).
6. Toggle ESN off as admin; attempt to add a new ESN card as a different user → blocked.
7. View the event participants list; the registration shows whether a discount was used and the discount amount.

## Expected Outcomes
- Pricing respects tenant enablement and credential validity on event start.
- Uniqueness enforced for ESN card identifiers across the platform.
- Clear error messages for invalid/expired/unavailable validation responses.
