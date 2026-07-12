---
evorto: patch
---

Avoid cross-tenant registration-transfer deadlocks by reading notification
addresses without taking unnecessary global user-row locks.
