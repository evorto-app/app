# Server Effect Runtime Guidelines

- Keep runtime composition Effect Platform-first (HTTP, routing, layers, contexts).
- Keep `/rpc` on the same server runtime path as the rest of the HTTP app (shared `HttpRouter` runtime + layered `RpcServer.toHttpEffect(...)`), not a separate RPC-only web handler runtime.
- Keep RPC handlers framework-agnostic and avoid adapter-specific leakage.
- Centralize request context headers/constants and reuse shared helpers.
- Prefer `Context.Service` for server services and keep dependency wiring at layer composition boundaries.
- Avoid direct `process.env` reads in Effect runtime code; use validated config modules/services.
- Use Effect logging primitives for runtime diagnostics (`Effect.log*`), not ad-hoc console logging.
- When middleware or runtime behavior changes, update track handoff/revisit docs in the same change.
- In Effect runtime adapters, never swallow promise failures; use `Effect.tryPromise(...)` and map only known, expected errors.
- After every Effect runtime file edit, run `bun run lint` and `bun run format:write`.
- Before calling WebStorm `get_file_problems` on edited Effect runtime files, run `bun run lint` first.
- Markdown files do not need a WebStorm `get_file_problems` pass.
- After editing an Effect runtime file, run WebStorm `get_file_problems` on that file when possible before finishing.
