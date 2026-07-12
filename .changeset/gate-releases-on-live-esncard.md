---
evorto: patch
---

# Gate repository releases on live ESNcard certification

Require protected active and permanently expired non-production ESNcard
identities to pass live add, refresh, remove, expired-state, and provider-error
UI verification before the repository release job can continue. Deployment
orchestration is intentionally left to its separate change.
