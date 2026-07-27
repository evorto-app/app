---
default: patch
---

Remove the legacy Auth0 `globalAdmin` platform-authority alias and fail loudly
when persisted tenant roles contain platform-global permissions instead of
silently discarding corrupt authority data.
