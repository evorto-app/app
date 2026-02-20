# Server Effect Runtime Guidelines

- Keep runtime composition Effect Platform-first (HTTP, routing, layers, contexts).
- Keep RPC handlers framework-agnostic and avoid adapter-specific leakage.
- Centralize request context headers/constants and reuse shared helpers.
- When middleware or runtime behavior changes, update track handoff/revisit docs in the same change.
- In Effect runtime adapters, never swallow promise failures; use `Effect.tryPromise(...)` and map only known, expected errors.
