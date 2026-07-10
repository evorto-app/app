---
evorto: patch
---

# Stabilize Neon Local shutdown on Docker Desktop

- keep Neon Local branch metadata in a project-scoped Docker volume by default,
- initialize the metadata mount for Neon's unprivileged runtime user,
- share the same metadata volume with the branch-expiration fallback,
- fail closed instead of autonomously restarting Neon without the expiration sidecar,
- retain only the explicit non-secret service log allowlist in CI artifacts, and
- retain an explicit host-directory override for controlled environments such as CI.
