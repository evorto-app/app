---
default: patch
---

# Cancel initial popup navigation during browser cleanup

Abort intercepted popup navigations whose frame is not yet available without
reporting that expected absence as a cleanup failure. Preserve unexpected
frame-access, document-preparation, and cancellation errors.
