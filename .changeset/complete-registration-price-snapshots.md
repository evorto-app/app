---
default: patch
---

Persist complete historical price terms when registrations are confirmed or approved, including zero discount amounts for undiscounted registrations and transfers. Reject partial, inconsistent, or missing confirmed price snapshots in the database while allowing unpriced pending applications before approval.

Applying the schema rejects existing incomplete or inconsistent rows. Historical payment terms must be reviewed from their original records; this change does not reconstruct or automatically rewrite financial history.
