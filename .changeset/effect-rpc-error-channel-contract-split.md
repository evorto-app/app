---
evorto: patch
---

# Split public RPC errors from server implementation errors

Restructure Effect RPC error handling so the shared contract exposes only
serializable public tagged errors while server-only implementation and
integration failures stay on the server side.

- move public domain error schemas next to their RPC contract modules,
- keep global boundary errors centralized in `src/shared/errors/rpc-errors.ts`,
- preserve defects until the server boundary instead of normalizing them into
  ordinary RPC failures, and
- align handlers with typed `Schema.TaggedError` contracts and explicit mapping.
