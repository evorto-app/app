---
default: patch
---

Keep Google Maps and live ESNcard checks available in linked worktrees by
loading only missing approved test values from the primary checkout. Preserve
every worktree's own database and runtime settings, and keep missing values as
visible failures.
