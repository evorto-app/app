---
default: patch
---

# Consolidate repeated image verification fixtures

Check all forbidden shell paths, packaged paths, and removed-provider contents
in three verifier invocations instead of nineteen. Retain an assertion for
every reported match and keep fail-fast artifact, symlink, readability, and
cleanup cases separate.
