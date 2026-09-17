---
default: patch
---

# Make release setup fail clearly

Stop release setup after the first setup failure and preserve the original
details for support.

Make deployments fail clearly and require a corrected release instead of
attempting a risky rollback.
