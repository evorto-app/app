---
evorto: patch
---

# Tighten Neon Local CI wiring and TLS guardrails

Follow up on Neon Local runtime review feedback by:

- forwarding Neon branch-related environment variables into the Docker `db` service for CI runs,
- removing the unnecessary CI hard-fail on `PARENT_BRANCH_ID` because Neon defaults to the project's default branch when it is unset,
- restoring `@db/*` imports in Playwright fixtures,
- limiting the Neon Local TLS certificate bypass to local proxy hostnames only.
