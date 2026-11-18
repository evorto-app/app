---
default: patch
---

# Compute the application fee in one place

- compute the Stripe application fee for registrations, transfers and add-ons with one helper,
- read the rate from `STRIPE_APPLICATION_FEE_RATE` (default `0.035`, unchanged), rejected at startup unless it is at least 0 and below 1.
