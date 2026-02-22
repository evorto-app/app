# Server Effect Runtime Guidelines

- Keep runtime composition Effect Platform-first (HTTP, routing, layers, contexts).
- Keep `/rpc` on the same server runtime path as the rest of the HTTP app (shared `HttpLayerRouter` runtime + layered `RpcServer.toHttpApp(...)`), not a separate `RpcServer.toWebHandler(...)` runtime.
- Keep RPC handlers framework-agnostic and avoid adapter-specific leakage.
- Centralize request context headers/constants and reuse shared helpers.
- Prefer `Effect.Service` for server services and keep dependency wiring at layer composition boundaries.
- Avoid direct `process.env` reads in Effect runtime code; use validated config modules/services.
- Use Effect logging primitives for runtime diagnostics (`Effect.log*`), not ad-hoc console logging.
- When middleware or runtime behavior changes, update track handoff/revisit docs in the same change.
- In Effect runtime adapters, never swallow promise failures; use `Effect.tryPromise(...)` and map only known, expected errors.
- After editing an Effect runtime file, run WebStorm `get_file_problems` on that file when possible before finishing.
