---
default: patch
---

# Keep compensated Checkout replays idempotent

Recognize an existing full eligibility-compensation refund before finalizing a transfer Checkout again, preventing a second refund claim from blocking an otherwise idempotent replay. Preserve exact source-payment ownership and refund terms.

Record registration and add-on reconciliation failures before attempting to persist a retry schedule, so the original failure remains visible when rescheduling also fails. Keep rescheduling failures explicit. Align manual-approval hydration waits and validate retry-fixture ownership before changing payment snapshots.

## Restore existing registration payments

Let platform administrators restore an existing registration payment from
organization finance with a required reason and an atomic audit record. Verify
the saved claim and original Stripe session before binding; keep uncertain or
mismatched payments held without creating another Checkout. Preserve approval
notification delivery history and use normal reconciliation for completion or
expiry.

Validate the complete private recovery audit snapshots before persisting their original incident history and restored session state.

Keep organization finance within the available page width and adapt its columns
to the panel size, so recovery controls remain reachable on narrow screens.
