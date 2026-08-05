---
default: patch
---

Require Auth0 request handling to receive the normalized protocol and Host from
the trusted inbound boundary, without deprecated header or localhost fallbacks.
Rebuild every Web Request from that normalized boundary before SSR, RPC,
webhook, telemetry, worker, or operations handling, and treat Angular's
explicit route-discovery lifecycle as the only server initialization without a
request context. Apply request normalization exactly once by sending
Node-adapted requests directly to the application routes while the Bun runtime
continues to enforce the boundary at ingress.
