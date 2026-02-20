# Server Guidelines

## Runtime Architecture

- Prefer Effect and Effect Platform first.
- Use Bun-native capabilities when Effect does not provide the needed primitive.
- Do not introduce new Express/Hono server paths.

## API and Validation

- Keep API contracts in Effect RPC + Effect `Schema`.
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

- Use `consola` (avoid direct `console.*`).
- Create scoped loggers with `consola.withTag('server/<feature>')`.
- Use `CONSOLA_LEVEL` for runtime verbosity control when needed.
