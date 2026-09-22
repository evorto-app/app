---
default: patch
---

Prevent Chromium from replaying intercepted tenant requests during test page cleanup by settling browser requests before closure while draining each original upstream request once.
