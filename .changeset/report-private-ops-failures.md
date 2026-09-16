---
default: patch
---

# Report private ops failures safely

Return only a fixed failure category from private schema operations so a
failed deployment is actionable without exposing database output, and verify
managed PostgreSQL certificates against IP connection identities explicitly.

Reject a missing or malformed database runtime role before private ops routes
start, so a staging reset cannot drop the schema before discovering that required
configuration. Validate the actual child process environment, rather than accepting
a dotenv-only fallback, and share the identifier check with the prerequisites command.
