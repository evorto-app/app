---
default: patch
---

# Complete transactional registration notifications

- render accessible HTML and plain-text lifecycle emails with React Email,
- queue idempotent confirmation, cancellation, waitlist-availability, and transfer messages in the same database transactions as their registration transitions,
- link confirmed participants back to their authenticated ticket page without turning the URL into a bearer credential, and
- keep delivery retries, leases, sender policy, and operator visibility at the durable outbox boundary.
