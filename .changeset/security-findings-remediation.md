---
default: patch
---

# Harden tenant authorization, trusted media, payments, and registration concurrency

- separate tenant-role permissions from platform-global authority, isolate
  cached permissions and data per browser or SSR application, and execute event
  organizer/edit guards directly while retaining server authorization as the
  source of truth,
- bind public links, receipt uploads, and icon catalog writes to trusted tenant context,
- bound Stripe webhook ingress and require persisted checkout/account/payment bindings,
- apply security headers and sanitized server fallbacks before response transmission while preserving client aborts, and
- serialize active registrations and pending checkout claims across concurrent requests.
