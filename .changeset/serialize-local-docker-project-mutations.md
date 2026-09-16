---
default: patch
---

Prevent two local setup commands from changing the same development services
at once. A conflicting command now stops immediately and identifies the active
operation instead of racing a database reset.

Keep project ownership stable across temporary-directory overrides and retain it through host Playwright startup, application cleanup, and object-storage restoration.
