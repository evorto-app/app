---
default: patch
---

Keep PostgreSQL pool capacity reserved until discarded connections physically
close, including cancellation on retained checkouts.
