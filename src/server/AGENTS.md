# Server Guidelines

- Logging: use `consola` across server code (avoid direct `console.*`).
- Create scoped loggers with `consola.withTag('server/<feature>')` and use level methods (`debug`, `info`, `warn`, `error`) consistently.
- Use `CONSOLA_LEVEL` for runtime verbosity control when needed.
