---
default: patch
---

Run the application from a pinned, non-root distroless image with Bun as the direct entrypoint, and refresh the Angular server rendering, rich text editor, HTML conversion, and CSS tooling dependencies to supported security fixes. Run Angular CLI package scripts on Node 24.15.0, while retaining Bun 1.3.14 for package management and the application runtime. Docker image builds compile Angular and ops with native builder tools, then assemble the runtime with target-platform Bun and a separate production dependency install. Local web and worker containers use that same entrypoint and retain logs through Docker. Deployment workflows hash the packaged schema on the runner without starting the image. The image gate continues to reject every HIGH or CRITICAL vulnerability. No database schema changes are included.
