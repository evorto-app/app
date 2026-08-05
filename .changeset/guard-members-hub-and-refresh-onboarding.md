---
default: patch
---

Require the Members Hub capability at the route and RPC boundaries, fail closed
when guarded routes omit permission metadata, avoid unauthorized admin review
queries, and fully reload the application after onboarding so server-derived
permissions cannot remain stale.
