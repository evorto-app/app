---
default: patch
---

# Verify the private database endpoint

Verify managed PostgreSQL certificates against the actual connection host by
default so Scaleway's private-only database certificate matches schema and
runtime connections, while retaining an optional server-name override for
other providers.
