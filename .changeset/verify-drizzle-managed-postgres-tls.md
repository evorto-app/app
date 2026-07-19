---
default: patch
---

# Verify managed PostgreSQL TLS during schema deployment

Configure the packaged Drizzle schema tool with Scaleway's managed database CA
instead of opening an unverified URL-only connection.
