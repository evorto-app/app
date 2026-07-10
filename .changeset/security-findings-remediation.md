---
evorto: patch
---

# Harden tenant authorization, trusted media, payments, and registration concurrency

- separate tenant-role permissions from platform-global authority and protect organizer data,
- bind public links, receipt uploads, and icon catalog writes to trusted tenant context,
- bound Stripe webhook ingress and require persisted checkout/account/payment bindings, and
- serialize active registrations and pending checkout claims across concurrent requests.
