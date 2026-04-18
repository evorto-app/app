---
evorto: patch
---

# Stabilize Bun local runtime around Neon and Effect RPC SSR transport

Improve local Bun runtime reliability for migration and CI parity by:

- preferring Neon local fetch transport paths (no websocket handoff) in app and Playwright DB clients,
- removing transaction-only registration seeding writes that forced websocket fallback under Neon local,
- aligning runtime test defaults to deterministic local ports for auth callback consistency,
- resolving server-side Effect RPC requests through an absolute `/rpc` origin during SSR.
