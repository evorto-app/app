---
default: patch
---

Reject non-local database targets from every local Drizzle schema path, make
database seeding transactional, require explicit seed tenant and role inputs,
and verify staging RPC health through a typed unauthenticated request.
