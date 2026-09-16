---
default: patch
---

Wait for the host Playwright app to finish cleanup before restoring its local object storage when shutdown signals repeat. Preserve the first shutdown status and leave previously running storage containers running.
