---
default: patch
---

Keep PostgreSQL pool capacity reserved until discarded connections physically
close, including cancellation on retained checkouts.

Preserve complete database names after the first separator in raw Unix-socket
configuration for both PostgreSQL clients, including spaces and Unicode.
