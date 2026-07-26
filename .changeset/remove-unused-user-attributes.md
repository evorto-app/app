---
default: patch
---

Remove the unused user-attributes database view, request-context query, and
internal RPC state so organizer access relies only on current confirmed
registration checks.
