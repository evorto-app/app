# Quickstart: Tenant‑wide Discount Enablement

This quickstart walks through admin toggling, user ESNcard management, and discounted registration.

## Steps
1. As tenant admin, open Settings → Discounts and enable ESNcard.
2. As a user, go to Profile → Discount Cards, add your ESNcard number, and verify.
   - If ESN is enabled and you have no verified card, you will see an explanation and a “Get your ESNcard” link.
   - **Environment constraint:** verification currently requires a live ESNcard credential. Automated tests skip this step until stable test identifiers are available.
3. Create an event template with a paid registration option (e.g., base €10) and add an ESNcard discounted price (€5).
4. Create an event from the template; the discount definition is duplicated to the event option.
   - If your workspace enforces event approval, submit the event and approve it as an admin so participants can access the registration flow.
5. Register as the user with a verified ESNcard:
   - The lowest eligible price is applied.
   - If discounted price is €0, the registration is confirmed immediately (no payment).
6. Toggle ESN off as admin; attempt to add a new ESNcard as a different user → blocked.
7. View the event participants list; the registration shows whether a discount was used and the discount amount.

## Test Data Constraints
- ESNcard validation depends on the external esncard.org service and does not ship with deterministic staging numbers. Local/CI automation skips the verification flows until official fixture identifiers are provided.
- Event creation may require manual approval depending on tenant policies; ensure the approval happens before attempting participant-facing steps.

## Expected Outcomes
- Pricing respects tenant enablement and credential validity on event start.
- Uniqueness enforced for ESNcard identifiers across the platform.
- Clear error messages for invalid/expired/unavailable validation responses.
