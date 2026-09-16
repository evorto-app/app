---
default: patch
---

Resolve local command environments separately for each invocation so concurrent commands cannot select another command's Docker project or database through `.env.dev`. Preserve explicit environment overrides and dotenv expansion, and pass resolved values in memory with native command signals and exit status. Hold the Docker project lease for the full Drizzle Studio session, and validate seed configuration before local database reset.

Derive and validate encoded container database URLs before acquiring Docker ownership, preserve literal healthcheck arguments, and enforce Compose-compatible project names.

Validate the final local database host, port, and database before dispatching commands or opening Playwright pools. Keep the application database separate from the reserved integration database, and use the PostgreSQL driver's database-name parsing for integration guards.

Bootstrap the standalone PostgreSQL integration database after validating its disposable target and server version, without resetting the application database.
