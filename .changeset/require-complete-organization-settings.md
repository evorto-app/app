---
default: patch
---

Require complete organization policies, receipt countries, currency, and timezone instead of inventing values when settings are missing. Reject fractional or out-of-range limits before saving, support the Classic theme in the current settings forms, and use the latest versioned privacy policy as the only policy source.

Ship the Classic palette and browser chrome colors together with its persisted setting and administration controls.

Reject stale organization settings forms before changing persisted values, keep unsaved edits visible, and offer an explicit reload of the latest settings.

Keep organization saves pending through refresh and navigation, advance the saved
snapshot without replacing newer drafts, and report concurrent domain claims as
an existing-domain conflict instead of an internal error.

Check the current settings snapshot before fetching destination-account tax rates
during Stripe account rotation. Release the database lock for the provider request
and recheck the snapshot under lock before writing, preserving conflict recovery.

Reject non-boolean receipt-country policies in direct consumers and verify PostgreSQL project discovery against every integration spec in the source tree.

Return typed unauthorized or not-found responses when a tenant disappears before discount settings or registration pricing are read, while preserving strict validation failures for malformed stored settings.
