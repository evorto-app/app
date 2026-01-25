# Events Feature Notes

## ESNcard pricing in event editing
- Registration option forms expose ESNcard discounted prices only when the provider is enabled.
- Discounts are saved as JSON on `registrationOptions.discounts` and validated server-side.
- Editors should not see discount inputs when ESNcard is disabled for the tenant.
- The `registration-option-form` component is the single UI surface for editing discount prices.
