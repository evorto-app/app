---
default: patch
---

Return `Connection: close` when an HTTP request asks to close the connection, so pooled clients retire the completed response's socket. Preserve response bodies, redirects, caching, and security headers.
