---
default: patch
---

Persist complete historical price terms when registrations are confirmed or approved, including zero discount amounts for undiscounted registrations and transfers. Reject partial, inconsistent, or missing confirmed price snapshots in the database while allowing unpriced pending applications before approval.

Recheck event availability, captured prices and discounts, current verified-card eligibility and provider settings, and selected add-on terms after acquiring registration locks. Reject concurrent setup changes before recording a sign-up, waitlist entry, approval, or payment claim, and ask the user to review the current details. Serialize card writes before their card-row and uniqueness checks so a concurrent card refresh, removal, or replacement cannot leave a stale discount or deadlock a sign-up.

Applying the schema rejects existing incomplete or inconsistent rows. Historical payment terms must be reviewed from their original records; this change does not reconstruct or automatically rewrite financial history.
