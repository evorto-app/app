---
default: patch
---

# Make registration seeding tenant-explicit

- require the seed tenant and currency instead of selecting an arbitrary tenant,
- reject cross-tenant event input and missing base users, and
- remove optional-ID and currency fallbacks from registration seed writes.
