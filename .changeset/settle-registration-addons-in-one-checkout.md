---
default: patch
---

# Settle registration add-ons in the initial Checkout

- persist the registration payment claim before paid add-on lots reference it, and
- verify one Checkout and payment allocation covers both the registration and its paid registration-time add-ons, while included-only entitlements never become paid Checkout lines.

Bound each price lot, subtotal, and combined Checkout total before reserving or
persisting inventory so unsupported PostgreSQL amounts return a visible
registration conflict.
