---
default: patch
---

# Reconcile Checkout cancellation before releasing registrations

- require Stripe to confirm a bound Checkout is expired before cancelling its local payment claim or releasing reserved capacity,
- keep unbound or unconfirmed payment claims intact with an explicit retry path,
- serialize completion and expiry webhooks with registration-first row locks and exact transaction/session ownership, and
- cover competing completion and expiry delivery against real Postgres state.
