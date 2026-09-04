---
default: patch
---

Prevent two local setup commands from changing the same development services
at once. A conflicting command now stops immediately and identifies the active
operation instead of racing a database reset.
