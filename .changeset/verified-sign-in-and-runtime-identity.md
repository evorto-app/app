---
default: patch
---

Require complete sign-in settings and sessions. Keep administrator access tied
to the verified administrator claim, refresh access after account setup, and
show incomplete sign-in details as a failure instead of treating them as a
signed-out session.

Require an explicit deployment environment, application role, worker trigger,
and database TLS choice. Authenticated tests use a temporary administrator
claim and restore its previous value after sign-in, including failed setup.
