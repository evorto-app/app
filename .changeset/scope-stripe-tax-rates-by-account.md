---
evorto: patch
---

Scope imported Stripe tax rates to their owning Connect account, reject stale
or unowned metadata in payment configuration and Checkout paths, and clear all
imported rates atomically when the connected account changes.

This is an expand rollout with an idempotent, fail-closed operator command that
retrieves each legacy rate through the tenant's current Connect account,
refreshes provider-owned fields, stamps verified ownership, and blocks release
on any unresolved or stale account binding. It then atomically installs
temporary database integrity triggers that prevent older application writers
from creating null-owned rates or changing an account before its tax metadata
is removed. Run the command after the nullable schema expansion and before
releasing application versions that require account-owned rates; deployment
automation is handled separately. The schema-managed tenant/rate unique index
remains a live contract for the current platform import upsert and may be
removed only after that conflict target is migrated. The temporary guards
remain until a later non-null contract release; see
`STRIPE_TAX_RATE_ACCOUNT_ROLLOUT.md`.
