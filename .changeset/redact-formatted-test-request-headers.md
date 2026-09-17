---
default: patch
---

Redact credential headers in Playwright failure diagnostics even when request logs contain terminal formatting. Preserve failed-test details and prevent protected values in formatted attachments from escaping the reporter.
