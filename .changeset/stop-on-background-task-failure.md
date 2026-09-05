---
default: patch
---

Stop the background worker when an email or payment processor fails. Preserve
failure details and durable work so an operator can inspect the failure before
restarting.
