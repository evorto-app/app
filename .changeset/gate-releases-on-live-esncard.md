---
evorto: patch
---

# Gate releases on live ESNcard certification

Require the protected, non-production ESNcard identity to pass live add,
refresh, remove, and provider-error UI verification before either the repository
release job or the actual main-branch Fly deployment can continue.
