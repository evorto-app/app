---
default: patch
---

Retain ownership of bounded test commands through cancellation and descendant
shutdown. Docker test startup now uses an owned cancellation channel and waits
for settlement before teardown, preserving command failures alongside cleanup
failures without signalling process identifiers after their owner has exited.
