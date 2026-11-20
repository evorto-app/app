---
default: patch
---

# Support reseeding the managed staging database

Staging clears and rebuilds the application objects using the deployment
database role while preserving Scaleway's public schema and extensions.
