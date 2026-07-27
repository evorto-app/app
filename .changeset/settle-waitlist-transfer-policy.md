---
default: patch
---

# Settle waitlist and participant transfer policy

- keep waitlist entries outside the tenant active-registration limit and enforce the limit only when a real registration is created, and
- make private offer-and-claim the only participant transfer flow, complete free questionless claims immediately, keep paid transfers asynchronous through Stripe, and remove the obsolete participant direct-reassignment RPC.
