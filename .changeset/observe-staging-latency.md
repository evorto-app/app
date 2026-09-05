---
default: patch
---

# Improve staging response diagnostics

- distinguish time spent in sign-in, workspace selection, page rendering, and
  event loading, and
- record only bounded response context so investigations do not capture
  personal values.
