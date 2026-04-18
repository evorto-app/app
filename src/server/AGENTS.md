# Server Guidelines

## Runtime Architecture

- Prefer Effect and Effect Platform first.
- For Effect reference material, implementation details, and examples, consult the upstream Effect repo at [Effect-TS/effect](https://github.com/Effect-TS/effect). If you keep a local clone for faster lookup, point repo-specific tooling or an environment variable at that clone instead of hardcoding a workstation path.
- Organize server capabilities with Effect dependency injection (`Effect.Service` + composed `Layer`s).
- Keep service dependencies declared in service definitions; wire app composition with flat `Layer.mergeAll` / `Layer.provideMerge`.
- Keep runtime configuration centralized in `src/server/config/**`; prefer native Effect `Config.*` combinators and resolve optional/default behavior at that boundary.
- Preserve honest config types at the config boundary; prefer `Option` for meaningful absence and only flatten to `undefined` or plain values at the consumer boundary that actually needs it.
- Use Bun-native capabilities when Effect does not provide the needed primitive.
- Do not introduce new Express/Hono server paths.

## API and Validation

- Keep API contracts in Effect RPC + Effect `Schema`.
- Server boundaries must use Effect `Schema` for validated input/output.
- Maintain fully typed input/output boundaries and explicit error mapping.
- Reuse shared RPC contracts from `src/shared/rpc-contracts/**`.

## Auth, Storage, and Integrations

- Keep Auth0 integration aligned with `@auth0/auth0-server-js` architecture.
- For Auth0 SDK calls, keep `Effect.tryPromise(...)` and handle only known SDK/domain errors explicitly.
- Do not convert unknown Auth0/runtime failures into `undefined`/silent fallback values.
- For known Auth0 errors, map to deterministic HTTP/domain responses; for unknown errors, fail and log with context.
- Reference known Auth0 error classes from upstream when defining mappings: [auth0-server-js errors.ts](https://github.com/auth0/auth0-auth-js/blob/main/packages/auth0-server-js/src/errors.ts).
- Prefer Bun-native storage clients (for example Bun `S3Client`) for object storage integrations.
- Keep server-side security headers and webhook protections aligned with current runtime middleware.

## Logging

- Use Effect platform logging (`Effect.log`, `Effect.logInfo`, `Effect.logWarning`, `Effect.logError`).
- Prefer structured log annotations (`Effect.annotateLogs`) over interpolated log strings.
- Do not use `consola` or direct `console.*` in server runtime code.
- Before calling WebStorm `get_file_problems` on edited server files, run `bun run lint:fix` first.
- After editing a server file, run WebStorm `get_file_problems` on that file when possible before finishing.
