---
default: patch
---

# Preserve the payment window after transfer reservation work

Calculate a paid ticket transfer's Checkout expiry immediately before storing
its payment claim. Keep the offer deadline and payment safety margin, including
when reservation work takes time or finishes on an exact second boundary.

Remove repeated image-verifier scenarios and tests that only pin documentation
wording. Preserve cache, shell detection, cleanup, and payment behavior checks.
