---
evorto: patch
---

# Release registrations after an unbound Checkout expires

- sweep a bounded batch of expired registration payment claims that never bound a Stripe Checkout session,
- serialize cleanup with approval, cancellation, and webhook transitions before cancelling the exact local claim, and
- release the registration's reserved capacity and add-on inventory atomically.
