---
default: patch
---

Repeat safe schema reconciliation and empty-staging initialization when retrying
an unchanged deployment image. Release the worker and web roles at the same
reviewed digest only after those prerequisites succeed.
