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
- Prefer Bun-native storage clients (for example Bun `S3Client`) for object storage integrations.
- Keep server-side security headers and webhook protections aligned with current runtime middleware.

## Logging

- Use `consola` (avoid direct `console.*`).
- Create scoped loggers with `consola.withTag('server/<feature>')`.
- Use `CONSOLA_LEVEL` for runtime verbosity control when needed.
