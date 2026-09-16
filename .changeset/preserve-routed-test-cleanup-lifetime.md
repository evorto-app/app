---
default: patch
---

Keep failed routed test requests and documentation database cleanup under their fixture owners, preserving request and cleanup errors without interrupting unfinished cleanup.

Return `Connection: close` when an HTTP request asks to close the connection, so pooled clients retire the completed response's socket. Preserve response bodies, redirects, caching, and security headers.

Preserve complete browser request headers during tenant routing and keep failed route-removal ownership until context closure is proven. Cancel rejected and bodyless HTTP request streams, preserve HEAD discovery-document responses, and reject malformed internal SSR origins before URL normalization.

Use typed sign-in recovery when an encrypted session's optional profile claims do not match the shared RPC contract. Keep valid custom metadata available to request authorization.
