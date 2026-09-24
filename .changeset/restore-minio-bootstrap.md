---
default: patch
---

# Restore local storage bootstrap on clean runners

Build the pinned MinIO server and client releases from checksum-verified source
archives on a pinned Alpine runtime. This removes unavailable upstream images
while preserving bucket initialization and the server's health check.
