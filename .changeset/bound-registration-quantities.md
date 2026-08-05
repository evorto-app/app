---
default: patch
---

# Bound registration quantities before persistence and Checkout

- cap guests, per-registration add-on units, and add-on types at the RPC, service, allocator, and fresh-database boundaries, and
- reject Stripe Checkouts above 100 line items before any capacity or stock reservation.
