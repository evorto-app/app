---
default: patch
---

# Delete code without production callers

- remove the unused add-on payment-allocation chain, `events.cancelPendingRegistration`, `events.findOneForEdit`, `admin.roles.search` and `users.userAssigned`,
- remove unused shared and server helpers, the server RPC-error re-export shim and the duplicate RPC error alias names,
- point the app at the shared Stripe Checkout URL normalizer and drop its app copy; the shared parser no longer needs `URL.canParse`, which Safari before 17 lacks,
- record the deletions as current evidence for review-queue rows C-005, C-007 and C-043.
