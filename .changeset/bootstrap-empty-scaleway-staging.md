---
default: patch
---

# Bootstrap an empty Scaleway staging database safely

Initialize deterministic staging data before deploying web only when every
application table is empty. Preserve all existing staging data during normal
deployment reconciliation and fail closed when partial data lacks the required
staging tenant.

Use PostgreSQL's canonical receipt-expiry default expression so repeated schema
plans remain stable after the first application.
