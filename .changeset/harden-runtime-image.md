---
default: patch
---

# Harden the production runtime image

Run the application from a pinned non-root distroless Debian image, start Bun
directly, and rely on container stdout instead of a shell-based log duplicator.
