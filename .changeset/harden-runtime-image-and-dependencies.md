---
default: patch
---

Run the application from a pinned, non-root distroless image with Bun as the direct entrypoint, and refresh the HTML conversion and CSS tooling dependencies to supported security fixes. Local web and worker containers use that same entrypoint and retain logs through Docker. Deployment workflows hash the packaged schema on the runner without starting the image. The image gate continues to reject every HIGH or CRITICAL vulnerability. No database schema changes are included.
