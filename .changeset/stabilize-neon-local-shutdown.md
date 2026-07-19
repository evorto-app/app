---
default: patch
---

# Stabilize Neon Local shutdown on Docker Desktop

- keep Neon Local branch metadata in a project-scoped Docker volume by default,
- initialize the metadata mount for Neon's unprivileged runtime user,
- share the same metadata volume with the branch-expiration fallback,
- fail closed instead of autonomously restarting Neon without the expiration sidecar,
- fail startup when the expiration fallback cannot be installed,
- give Docker up to 60 seconds to stop Neon Local while retaining branch
  expiration as a fallback for interrupted deletion,
- remove Playwright-owned Compose objects after process exit or shutdown while
  refusing stopped persistent stacks and leaving reused user-owned stacks
  running,
- reject attempts to resume an already-deleted ephemeral branch,
- retain only the explicit non-secret service log allowlist in CI artifacts, and
- retain an explicit host-directory override for controlled environments such as CI.
