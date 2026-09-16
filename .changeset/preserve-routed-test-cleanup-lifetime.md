---
default: patch
---

Keep failed routed test requests and documentation database cleanup under their fixture owners, preserving request and cleanup errors without interrupting unfinished cleanup.

Return `Connection: close` when an HTTP request asks to close the connection, so pooled clients retire the completed response's socket. Preserve response bodies, redirects, caching, and security headers.
