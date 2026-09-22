---
default: patch
---

Keep shared setup, staging, and production separate so changes in one
environment cannot affect another.

Require production promotion to use the current main revision and recheck it
before deploying the schema role. Protect both the managed database instance
and the application database from planned destruction or replacement.
