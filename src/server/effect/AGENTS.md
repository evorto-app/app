# Server Effect Runtime Guidelines

- Use stable Effect 4 module paths such as `effect/http`, `effect/rpc`, and `effect/sql`; the prerelease `effect/unstable/*` paths are no longer exported.
- Keep `/rpc` on the same server runtime path as the rest of the HTTP app (shared `HttpRouter` runtime + layered `RpcServer.toHttpEffect(...)`), not a separate RPC-only web handler runtime.
- Keep RPC handlers framework-agnostic and avoid adapter-specific leakage.
- Centralize request context headers/constants and reuse shared helpers.
- Avoid direct `process.env` reads in Effect runtime code; use validated config modules/services.
- In Effect runtime adapters, never swallow promise failures; use `Effect.tryPromise(...)` and map only known, expected errors.
