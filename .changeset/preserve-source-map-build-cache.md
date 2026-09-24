---
default: patch
---

# Reuse the application build when exporting source maps

Keep the private source-map export outside the Docker build context so CI can
reuse the verified application build instead of compiling it again.
