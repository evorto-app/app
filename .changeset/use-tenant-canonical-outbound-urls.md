---
"evorto": minor
---

Persist and validate each tenant's canonical root URL, and use it for
tenant-scoped email and Stripe return links instead of request-controlled or
process-global origins. Public-URL migrations now wait for pending Stripe and
registration-transfer links to finish, and the platform UI documents the
old-domain redirect required for already-issued QR codes.
