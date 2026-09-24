---
default: patch
---

# Reuse the application build when exporting source maps

Keep the private source-map export outside the Docker build context so CI can
reuse the verified application build instead of compiling it again.
Check for the required PR change note before full verification to avoid an
unnecessary correction and repeat validation cycle.
