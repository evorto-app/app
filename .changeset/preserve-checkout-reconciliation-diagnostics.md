---
default: patch
---

# Keep compensated Checkout replays idempotent

Recognize an existing full eligibility-compensation refund before finalizing a transfer Checkout again, preventing a second refund claim from blocking an otherwise idempotent replay. Preserve exact source-payment ownership and refund terms.

Record registration and add-on reconciliation failures before attempting to persist a retry schedule, so the original failure remains visible when rescheduling also fails. Keep rescheduling failures explicit. Align manual-approval hydration waits and validate retry-fixture ownership before changing payment snapshots.
