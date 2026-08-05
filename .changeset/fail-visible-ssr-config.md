---
default: patch
---

Fail server-side rendering visibly when neither a configured RPC origin nor an
absolute Angular request URL is available, or when Angular request context is
missing during application configuration. Skip ConfigService construction only
during Angular's explicit route-discovery lifecycle.
