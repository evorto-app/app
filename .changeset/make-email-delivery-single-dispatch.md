---
default: patch
---

Dispatch each durable email notification at most once, keep failed or uncertain outcomes visible without retries, and include sent history in the platform overview. Stop polling workers when an unexpected worker failure occurs.

The coordinated relaunch schema removes stored sender/retry fields and enforces a single delivery attempt. Existing retry-state rows need explicit review before applying this schema; do not reconstruct their history or resend uncertain messages.

Use the email configuration readiness endpoint for worker startup, explain environment-policy suppression accurately, and bound incident ordering to indexed per-status candidates. Exact overview summary counts still scan retained delivery history. Apply the new status/update-time/id index with the coordinated relaunch schema.

Clarify that messages with an unknown delivery outcome will not be sent again, including by manual retry.
