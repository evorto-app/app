---
default: patch
---

# Report private ops failures safely

Return only a fixed failure category from private schema operations so a
failed deployment is actionable without exposing database output, and verify
managed PostgreSQL certificates against IP connection identities explicitly.
