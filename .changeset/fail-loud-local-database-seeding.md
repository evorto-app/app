---
default: patch
---

Reject non-local database targets from every local Drizzle schema path, make
database seeding transactional, require explicit seed tenant and role inputs,
verify staging RPC health through a typed unauthenticated request, and create
the disposable integration database during the guarded reset instead of from a
Docker Desktop host-file mount.
