# Contract: templates → events (Discount Duplication)

- During `events.create`, for each registration option copied from template:
  - Copy the `template_registration_options.discounts` JSON array to `event_registration_options.discounts` for the created option id mapping.
- Validation on write/update: each `discountedPrice` must be `<=` the base price.
