---
default: patch
---

Separate registration creation from choice-free Checkout retry, require exact
Stripe metadata and immutable registration price snapshots, surface cleanup
reschedule failures, and remove redundant transfer state and dead payment
paths. Block cancellation and check-in only while a transfer can still mutate
the registration, while continuing to block a new transfer through every
active refund stage.
