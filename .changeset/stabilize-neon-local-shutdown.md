---
evorto: patch
---

# Stabilize Neon Local shutdown on Docker Desktop

- keep Neon Local branch metadata in a project-scoped Docker volume by default,
- share the same metadata volume with the branch-expiration fallback, and
- retain an explicit host-directory override for controlled environments such as CI.
