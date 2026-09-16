---
default: patch
---

Require complete sign-in settings and sessions. Keep administrator access tied
to the verified administrator claim, refresh access after account setup, and
show incomplete sign-in details as a failure instead of treating them as a
signed-out session.

Require an explicit deployment environment, application role, worker trigger,
and database TLS choice. Authenticated tests require a preconfigured dedicated
administrator account without changing its shared claim during overlapping runs.

Reject blank required database certificates and verify the effective IPv6 connection host while preserving explicit server identities and strict TLS validation.
