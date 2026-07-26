---
default: patch
---

Avoid redundant Scaleway container revisions when the desired image,
configuration, and secrets already match the live role. Keep staging releases
behind the complete pull-request quality gate and provide the worker email
delivery dependency at the request boundary.
